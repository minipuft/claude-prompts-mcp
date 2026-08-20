---
title: "Semantic LLM Side-Client Retirement"
date: 2026-08-05
status: reference
tags: [cleanup, gates, config, breaking-candidate]
---

# Semantic LLM Side-Client Retirement

**Status**: **COMPLETE** (`reference` — cited by the follow-up sweep, so it stays in the tree rather than archiving) — T0 decided; T1, T2, T2.5, T3, T3.5, T3.6, T4, T5 all landed · F10, F12 resolved · F9, F11 carried to [reader-without-producer-sweep](./technical-debt/reader-without-producer-sweep-2026-08-05.md) so they survive archival
**Created**: 2026-08-05
**Supersedes nothing.** Follows the `llmIntegration.mode` fix (same session), which made the config
surface honest enough for this removal to be scoped.

---

## Findings (read these before the tiers — three of them change what the tiers should say)

### F1 — This is a dead-path deletion, not a feature removal

`DEFAULT_ANALYSIS_CONFIG.semanticAnalysis.llmIntegration.enabled` is `false`
(`infra/config/index.ts`), and the only config in this repo that tried to turn it on used the
`mode: "on"` spelling that no reader consulted. So `GateServiceFactory` has always taken its
`else` branch, and `SemanticGateService` has **never been constructed here**.

Consequence: the risk profile is "delete unreachable code," not "remove a working feature."
Verification can therefore be structural (no reachable construction site) rather than behavioural.

### F2 — The replacement already exists and is live

`src/engine/gates/judge/` (`judge-prompt-builder.ts`, `types.ts`) implements context-isolated gate
evaluation via delegation, reachable through the `%judge` modifier
(`command-parser.ts:146`, `execution-planner.ts:305`) and `gates.evaluation.defaultMode: 'judge'`.

Consequence: **no build-then-migrate tier is needed.** This plan is delete-only. Any tier that
proposes "implement subagent evaluation" is proposing something that shipped.

### F3 — `ConfigurableSemanticAnalyzer` is two things, and only one of them dies

| Consumer                                                                                        | Path used                          |
| ----------------------------------------------------------------------------------------------- | ---------------------------------- |
| `prompt-analyzer.ts`, `classification.ts`, `execution-planner.ts`, `prompt-resource-handler.ts` | the **minimal** path — runs today  |
| `SemanticGateService`                                                                           | the **llm** path — never runs (F1) |

`mcp/tools/index.ts:226` selects `llmIntegration.enabled ? 'semantic' : 'minimal'` and has always
resolved to `minimal`. Deleting the LLM half leaves a 382-line class with one mode, a name that
advertises configurability it no longer has, and a `llmUsed` metadata field that is always false.

Consequence: T3 is a genuine design decision, not mechanical cleanup. It is the only tier that
needs a judgment call, which is why T0 exists.

### F4 — This deletes a `config.json` section, which is in the declared public API contract

`CLAUDE.md` §Public API Contract lists "Resource formats: prompt/gate/methodology YAML schema,
**`config.json`**" as contract surface. A downstream user could have set
`analysis.semanticAnalysis.llmIntegration.enabled: true` directly — the MCP tool surface accepts
that key (`config-utils.ts:32`), unlike the CLI which only ever offered the inert spelling.

Consequence: removing the `analysis` section is **breaking, and needs a major bump**, or the
section stays parsed-and-ignored for one cycle with a deprecation warning. T0 must choose.
Do not let T4 make this decision implicitly by just deleting the type.

### F5 — Tier C added the schema section this plan removes

Earlier the same session, `config.schema.json` gained an `analysis` section because the schema was
incomplete and `validate:config-schema` could not pass without it. That was correct then — the
schema's job is to describe what the runtime reads. This plan removes the thing being described.
Not churn: honest schema first, then removal, in that order. Recording it so the diff reads right.

### F6 — `llm_self_check` is a second retirement surface, and the plan missed it (found at T0)

`llm_self_check` is a **gate `pass_criteria.type`** — part of the gate YAML schema, which
`CLAUDE.md` §Public API Contract names as contract surface. It is accepted by
`gate-schema.ts:83`, typed in `gate-primitives.ts:54`, documented as _Reserved — runner not yet
implemented_ in `docs/guides/gates.md:12`, `resources/gates/_index.md`, and the `create_gate`
example's `schema.json` + `script.py`, and asserted in 4 test files.

Its runner, `GateValidator.runLLMSelfCheck` (`gate-validator.ts:460`), is a stub that reads
`LLMIntegrationConfig` and returns a skip when disabled. That config arrives via
`prompt-executor.ts:197 → createGateValidator(logger, gateProvider, llmConfig)` — a wiring path the
original inventory did not list at all.

Consequence: retiring the `analysis` config (T4) severs this stub's config source. The type itself
is **not** deleted — it is already documented as non-functional, and `%judge` is its honest
replacement. T4 must decouple the stub rather than let the type dangle. Tracked as **T0.5**.

### F7 — An undocumented env surface dies with T1

`loadLLMConfigFromEnv()` read `MCP_LLM_ENABLED`, `MCP_LLM_API_KEY`, `MCP_LLM_ENDPOINT`,
`MCP_LLM_MODEL`, `MCP_LLM_MAX_TOKENS`, `MCP_LLM_TEMPERATURE`. `CLAUDE.md` §Environment declares
only `MCP_WORKSPACE`, `MCP_RESOURCES_PATH`, `MCP_CONFIG_PATH`, so these are not contract surface
and need no deprecation cycle. Recorded because a variable that silently stops being read is
otherwise indistinguishable from one that never worked.

---

## Inventory (measured 2026-08-05 — re-measure before executing; these drift)

| Unit                                                     | Lines | Fate                                           |
| -------------------------------------------------------- | ----- | ---------------------------------------------- |
| `src/modules/semantic/integrations/llm-clients.ts`       | 393   | delete                                         |
| `src/modules/semantic/integrations/index.ts`             | 198   | delete or collapse (T0)                        |
| `src/modules/semantic/configurable-semantic-analyzer.ts` | 382   | collapse + rename (T3)                         |
| `src/modules/semantic/types.ts`                          | 22    | trim                                           |
| `src/engine/gates/services/semantic-gate-service.ts`     | 114   | delete                                         |
| `src/engine/gates/services/gate-service-factory.ts`      | 58    | remove LLM branch                              |
| `src/engine/gates/services/gate-service-interface.ts`    | 46    | drop `llmIntegration` from `GateServiceConfig` |
| `tests/unit/semantic/semantic-analyzer.test.ts`          | 163   | rewrite to the surviving surface               |
| `tests/unit/gates/services/gate-services.test.ts`        | 106   | drop the LLM cases                             |

Config surface to retire: `AnalysisConfig`, `SemanticAnalysisConfig`, `LLMIntegrationConfig`
(`shared/types/core-config.ts`), `getAnalysisConfig` + `getSemanticAnalysisConfig`
(`shared/types/config-manager.ts:41-42`), 5 MCP tool keys (`config-utils.ts:32-35,43`),
1 CLI key + 1 restart-required entry (`config-input-validator.ts`), the `analysis` section in
`config.schema.json` and `config.json`.

---

## T0 ✅ COMPLETE 2026-08-05 — Boundary decisions (no code)

| ID  | Status | Decision                                                                      | Resolution                                                                                                                                                                                                                                                                |
| --- | ------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | ✓      | Does the `analysis` config section get deleted or deprecated-in-place?        | **(b) deprecate in place.** Kept parsed, documented deprecated, removed next major. **Version consequence: none this cycle — 3.1.x stays minor.** The removal is the breaking act and carries the major bump.                                                             |
| 0.2 | ✓      | What survives of `ConfigurableSemanticAnalyzer`?                              | **(a) collapse to a single-mode analyzer.** Four live consumers justify one owner.                                                                                                                                                                                        |
| 0.3 | ✓      | If 0.2(a): what is it called?                                                 | **No class rename needed** — the class is already `ContentAnalyzer`, an accurate name with a positive suffix. Only the **file** is misnamed: `configurable-semantic-analyzer.ts` → `content-analyzer.ts`. The plan overstated this; T3 is a file move, not an API rename. |
| 0.4 | ✓      | Does `%judge` / `evaluation.defaultMode` need doc work?                       | **Yes.** T5 owns it; T1 already landed the `cli.ts` + `cli.md` pointers.                                                                                                                                                                                                  |
| 0.5 | ✓      | _(added at T0 — F6)_ What happens to the `llm_self_check` gate criteria type? | **Keep the type; decouple the stub.** It is contract surface already documented as non-functional, so deleting it would break gate YAML for no gain. T4 removes its `LLMIntegrationConfig` dependency and points docs at `%judge`.                                        |
| 0.6 | ✓      | _(added at T0 — F7)_ Do the `MCP_LLM_*` env vars need a deprecation cycle?    | **No.** Undocumented in `CLAUDE.md` §Environment → not contract surface. Deleted with T1.                                                                                                                                                                                 |

**Gate**: ✓ every row answered; 0.1 names the version consequence (no bump this cycle; major at removal).

---

## T1 ✅ COMPLETE 2026-08-05 — Delete the LLM side client · depends T0.1 · in `b4171ca8`

| ID  | Status      | Step                                                                                                                      | Files                                                                            | Verification                                              |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1.1 | ✓           | Delete the LLM client factory and provider clients                                                                        | `src/modules/semantic/integrations/llm-clients.ts`                               | `rg -n "LLMClientFactory\|llm-clients" src/ tests/` → 0 ✓ |
| 1.2 | ✓           | **Delete the whole integration factory**, not collapse it — see note                                                      | `src/modules/semantic/integrations/index.ts` (deleted); `src/mcp/tools/index.ts` | `verify:mcp` 12/12 ✓                                      |
| 1.3 | ✓ (revised) | Drop the LLM plumbing — **`types.ts` holds no such fields**; the real removal is the analyzer's LLM branch, which is T3's | `src/modules/semantic/types.ts` unchanged                                        | `npm run typecheck` clean ✓                               |

**Gate**: ✓ `rg` for outbound model endpoints under `src/` → 0; `verify:mcp` 12/12; typecheck,
lint:ratchet, typecheck:tests:ratchet, and 1932 unit tests all green.

**What 1.2 actually found.** Once the LLM wiring was removed, `SemanticIntegrationFactory` had
nothing left: `createConfiguredAnalyzer` reduced to `createContentAnalyzer(logger, config)`,
`createFromEnvironment` merged only `MCP_LLM_*` vars (F7), and `validateConfiguration` +
`generateConfigurationGuide` had **zero callers repo-wide** — both were pure LLM-setup advice. The
directory had exactly one external consumer (`mcp/tools/index.ts`) and no tests, so "collapse"
would have produced a one-line pass-through wrapper. Deleted outright; `mcp/tools/index.ts` now
calls `createContentAnalyzer` directly, an import it already had.

**Two corrections T1 made beyond its rows:**

- The `analyzerMode` log line (`'semantic' : 'minimal'`) became a **falsehood the moment the client
  was deleted** — it would print "semantic" when no client could exist. The plan assigned this to
  T3.3, but T1 introduced the lie, so T1 removed it. Replaced with `Content analyzer initialized`,
  confirmed in the runtime log rather than inferred from a green build.
- `cli/src/cli.ts` help still advertised **all ten** retired `*.mode` spellings — a leftover the
  previous `llmIntegration.mode` task missed because it repointed `create.ts`/`toggle.ts`/
  `config.ts` but not the top-level help text. Repointed to the canonical keys; `analysis` kept and
  marked deprecated so `SUBSYSTEM_MAP` does not carry a hidden, undocumented command until T4.

**Deliberately left for T3** (recorded so its gate can check them): `ContentAnalyzer.setLLMClient`
and the `LLMClient` type now have **zero producers** — no implementation of `LLMClient` exists
anywhere, so `this.llmClient` is permanently `undefined` and the analyzer's LLM branch is
structurally unreachable. Compiles clean; removed in T3 with the dual-mode collapse.

---

## T2 ✅ COMPLETE 2026-08-05 — Delete `SemanticGateService` · depends T1 · in `b4171ca8`

| ID  | Status | Step                                                                                               | Files                                                | Verification                                    |
| --- | ------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| 2.1 | ✓      | Delete the service                                                                                 | `src/engine/gates/services/semantic-gate-service.ts` | `rg -n "SemanticGateService" src/ tests/` → 0 ✓ |
| 2.2 | ✓      | Remove the `if (llmIntegration?.enabled)` branch; `CompositionalGateService` becomes unconditional | `gate-service-factory.ts`, `pipeline-builder.ts`     | one return path ✓                               |
| 2.3 | ✓      | Drop `llmIntegration` from `GateServiceConfig`                                                     | `gate-service-interface.ts`                          | `npm run typecheck` clean ✓                     |
| 2.4 | ✓      | Remove LLM cases from the gate-service tests                                                       | `tests/unit/gates/services/gate-services.test.ts`    | 1933 unit + 664 gate integration green ✓        |

**Gate**: ✓ `createGateService()` is a single unconditional `return`; gate behaviour unchanged —
664 gate integration tests pass, including `gate-judge-pipeline-wiring` and
`structured-gate-verdict-flow`, which exercise the path rather than only the tool surface.

**Falsification (2.4).** The new regression guard was run against a deliberately reintroduced
branch before being trusted: a temporary probe returning a non-compositional service when the
retired flag was on made exactly the two llm-enabled cases fail while the llm-off case kept
passing, so the tests discriminate rather than merely pass. Probe reverted; `rg FALSIFICATION src/`
→ 0.

**2.2 also removed dead constructor wiring.** `GateServiceFactory` took a `GateValidator` that
**neither branch ever read** — the semantic service was constructed without it and the
compositional one takes no validator. Dropped from the factory and from its only call site
(`pipeline-builder.ts:430`). This is the same seam `semantic-gate-service.ts` documented removing
from itself; the factory copy outlived it.

**Union narrowing.** With one implementation left, `GateService.serviceType` and
`GateValidationResult.validatedBy` narrowed from `'compositional' | 'semantic'` to
`'compositional'`. `serviceType` is emitted as telemetry metadata by `GateMetricsRecorder`, so it
is now a single-valued dimension — worth removing, folded into T2.5 rather than done here.

**Comment discipline.** First drafts of the new comments named the deleted class, which both failed
row 2.1's own `rg` check and violated `cleanup-standards.md` (reference preservation). Rewritten to
state current behaviour — "selection is unconditional", "this type has no producer" — which is what
a future reader needs, and which makes the check pass honestly rather than by exemption.

---

## T2.5 ✅ COMPLETE 2026-08-05 — Retire the orphaned validation channel · discovered at T2 · in `b4171ca8`

**F8 — `validationResults` is a redundant channel, not a missing producer.**

`GateEnhancementResult.validationResults` has **live readers and zero producers**. The readers are
real: `gate-enhancement-service.ts:238` maps them into `context.state.gates.validationResults`, and
`gate-metrics-recorder.ts` converts them into gate metrics. The only producer was
`performSemanticValidation`, which threw instead of returning — so the channel has never carried a
value.

Zero writers admits two readings, and the user-facing interface decides which. Checked: the judge
path does **not** use this channel — `rg validationResults src/engine/gates/judge/
gate-verdict-processor.ts` → 0. Model-based verdicts arrive through `gate_verdict` →
`GateVerdictProcessor` instead. So this is a **redundant channel**, not a producer that still needs
writing.

Deliberately **not** executed inside T2: it touches `gate-enhancement-service.ts` and
`gate-metrics-recorder.ts`, neither in T2's Files column, and it changes an emitted metric shape —
a different unit of review than deleting an unreachable service.

| ID    | Status | Step                                                                                        | Files                                                                                                           | Verification                            |
| ----- | ------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 2.5.1 | ✓      | Decide: delete the channel, or keep it as the seam a future in-process validator would fill | —                                                                                                               | **DELETE** — rationale below            |
| 2.5.2 | ✓      | Drop `GateValidationResult`, `GateEnhancementResult.validationResults`                      | `gate-service-interface.ts`                                                                                     | `npm run typecheck` clean ✓             |
| 2.5.3 | ✓      | Remove the starved reader branches                                                          | `gate-enhancement-service.ts`, `gate-metrics-recorder.ts`                                                       | 664 gate integration tests green ✓      |
| 2.5.4 | ✓      | Remove `serviceType`, incl. its telemetry metadata field                                    | `gate-service-interface.ts`, `gate-metrics-recorder.ts`, `compositional-gate-service.ts`, `pipeline-builder.ts` | `rg -n "serviceType" src/ tests/` → 0 ✓ |

**Gate**: ✓ no type in the gates layer has readers but no producer. The two remaining
reader-without-producer surfaces found while verifying belong to a different lineage and are filed
as F9 rather than absorbed here.

### 2.5.1 — the decision, and what it rests on

**Delete.** Five measurements, not a preference:

1. `GateValidationResult` had **zero producers** anywhere in `src/`.
2. `context.state.gates.validationResults` was written at exactly one site and read at **zero** —
   a write to nowhere.
3. `metric.validationResult` could only ever be `undefined`, because its sole input was the empty
   channel. It surfaced only in a `logger.debug` call.
4. `gateUsageHistory` is pushed and trimmed but **never projected**. `InMemoryMetricsCollector` is
   the only `MetricsCollector` implementation and there is no exporter — so **no MCP response
   shape moves**, and this is not a contract change.
5. The decided replacement routes elsewhere: `%judge` returns verdicts through `gate_verdict` →
   `GateVerdictProcessor`. A future in-process validator would extend _that_ seam.

Against keeping it: `cleanup-standards.md` requires a retained seam to name the evidence that
fills it. Nothing could be named here, and an unfillable seam is a permanent bypass wearing a
temporary label.

### Scope extensions this tier made, and why each was in-bounds

Both were **created by** 2.5.3, not merely adjacent to it — removing the writer is what stranded them:

- **`GateUsageMetric.validationResult` + the `GateValidationResult` metrics type**
  (`shared/types/metrics.ts`, `infra/observability/metrics/index.ts`). After 2.5.3 removed the
  only assignment, this field had zero writers — the declaration-dead shape this repo runs
  validators against. Leaving it would have traded a starved channel for a starved field.
- **`context.state.gates.validationResults`** (`execution/context/internal-state.ts`). Its only
  writer was the branch 2.5.3 deleted, leaving zero writers and zero readers.

**Not extended into**: F9 below. Those are a different lineage.

### F9 — Two more reader-without-producer surfaces, different lineage — CARRIED, then RESOLVED

**Moved to [reader-without-producer-sweep](./technical-debt/reader-without-producer-sweep-2026-08-05.md#f9)
and executed there 2026-08-05 (`7a43f996`).** Original text below; note it names a
`GateValidator.getRetryHints` that does not exist, and `StepResult.validationResults` when the
whole interface was dead.

- **`GateValidator.shouldRetry` / `getRetryHints`** have **no callers**. `gates/core/index.ts:252`
  delegates to `shouldRetry`, and that wrapper is itself called by nothing —
  `rg "\.shouldRetry\(|\.getRetryHints\("` finds only the internal delegation. The whole
  retry-hint API is unreachable.
- **`StepResult.validationResults`** (`engine/gates/types.ts:298`) has no writers.

These belong to the gate **retry** system, not the semantic sidecar, so retiring them is not this
plan's job. Filed here because the measurement was taken; they want their own tier with their own
evidence about whether the retry path is meant to be live.

**Falsification (2.5.2).** The replacement key-set assertion was run against a reintroduced
channel before being trusted: adding `validationResults: []` back to the compositional service's
return failed exactly one test — the new one — and nothing else. Probe reverted;
`rg FALSIFICATION src/ tests/` → 0.

---

## T3 ✅ COMPLETE 2026-08-05 — Collapse the analyzer · depends T2, T0.2, T0.3 · in `b4171ca8`

| ID  | Status | Step                                                                 | Files                                                  | Verification                                         |
| --- | ------ | -------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| 3.1 | ✓      | Remove the dual-mode branch and the always-false `llmUsed` metadata  | `content-analyzer.ts`, `shared/types/core-config.ts`   | `rg -n "llmUsed\|'semantic' : 'minimal'" src/` → 0 ✓ |
| 3.2 | ✓      | Rename per T0.3; update consumers (**six**, not four — see below)    | `content-analyzer.ts` + 6 src consumers + 4 test files | typecheck + tests ratchet ✓                          |
| 3.3 | ✓      | Remove the `analyzerMode` log line that can now only print one value | `mcp/tools/index.ts`                                   | landed early in T1 ✓                                 |
| 3.4 | ✓      | Rewrite the analyzer tests against the surviving surface             | `tests/unit/semantic/content-analyzer.test.ts`         | 1933 unit · 468 integration · 43 e2e ✓               |

**Gate**: ✓ the analyzer has one analysis path and no LLM surface. 404 lines (382 analyzer + 22
`types.ts`) → **219**; `modules/semantic/` is now a single file.

**T0.3 was right that this is a file move, not an API rename.** `git mv` preserved history for
both the source and its test. The class stayed `ContentAnalyzer`, so the six consumers changed only
their import path.

**The plan said four consumers; there are six.** F3's table listed `prompt-analyzer`,
`classification`, `execution-planner`, `prompt-resource-handler`. Also importing the analyzer:
`mcp/tools/index.ts`, `resource-manager/prompt/core/types.ts`, and
`prompt-engine/core/prompt-executor.ts` — while `execution-planner` turned out to reference it
only from its **test**. Net six src importers, four test files.

**What was removed**: `LLMClient` (and `modules/semantic/types.ts`, which held nothing else),
`llmClient`, `setLLMClient`, `performLLMAnalysis`, `analyzeStructuralCharacteristics`,
`calculateTemplateComplexity`, `suggestExecutionGates`, `normalizeExecutionType`, the
`BUILTIN_FRAMEWORK_TYPES` import, `getPerformanceStats().llmIntegrationEnabled`, the
`llmIntegration` term in the cache key, and `analysisMetadata.llmUsed` (zero writers **and** zero
readers once the LLM path went — the same caused-by-this-tier removal T2.5 made).

`analyzePrompt` also lost a `try/catch` whose only recovery was to call the same total, pure
builder it had just called.

### Two decisions T3 made that the plan did not anticipate

**`isLLMEnabled()` is retained, deliberately.** It is on the `ContentAnalyzerPort` contract and
drives **user-visible output** in two live branches: `prompt-analyzer.ts:44` prints
"⚠️ API Analysis Disabled" and suppresses gate suggestions when false, and
`prompt-lifecycle-processor.ts:153` appends "💡 Suggested Gates" when true. It reports the _config
flag_, not client availability — so post-T1 it can still return `true` while no model-backed path
exists. Hardcoding it to `false` would silently change MCP response text, which is not a
collapse-the-analyzer change. Its fate belongs with the config it reads → **new row T4.7**.

**`analysisMetadata.mode` keeps its `'semantic'` union member.** No producer emits it any more, but
`framework-semantic-integration.ts` compares against it in five places; narrowing the union turns
those into no-overlap type errors. That file is dead (F10), and deleting it is what unblocks the
narrowing. Documented at the type rather than left to look like an oversight.

**Falsification (3.1).** Re-adding `llmUsed: false` to the metadata failed exactly one test — the
new one — and nothing else. Probe reverted.

**Ratchet.** `typecheck:tests:ratchet` caught the test rename, exactly as its message describes:
baseline tracked `semantic-analyzer.test.ts` at 2 errors, and the renamed file reported 2 — the
"looks fixed, actually moved" case. Rather than carry the debt to a new key, the two errors were
**fixed** (`ChainStep` has `promptId`/`stepName`, never `id`), leaving the new path at 0. The stale
key was then removed **surgically** rather than by regenerating the whole baseline, which could
have absorbed unrelated drift: 389 → 387 errors, 106 → 105 entries, no other entry touched.

### F10 — `FrameworkSemanticIntegration` is 863 lines that are never constructed

`createFrameworkSemanticIntegration` (line 849) is the only construction site for the class, and
**nothing calls that factory** — `rg "createFrameworkSemanticIntegration|new FrameworkSemanticIntegration"`
returns only the file's own two lines. The entire module is unreachable, including its five
`analysisMetadata.mode === 'semantic'` branches, which is why T3 did not need to touch them.

Not deleted at T3: an 863-line subsystem removal is its own unit of review, and it is not a
sidecar artifact — it predates this plan. Deleting it is the precondition for narrowing `mode`.

**RESOLVED — deleted in T3.5** (below), once the `mode` narrowing made it the blocking item rather
than a bystander. Confirmed dead three independent ways before removal: no construction site
outside its own factory; its directory barrel `engine/frameworks/integration/index.ts` had **zero
importers**; and `npx knip --include files` listed both files as unused. 869 lines removed.

---

## T3.5 ✅ COMPLETE 2026-08-05 — Retire `isLLMEnabled` and narrow `mode` · depends T3 · split across `b4171ca8` + `d219f8b7`

Requested directly after T3 rather than deferred into T4, because the two questions are coupled:
`mode` cannot narrow while F10 compares against `'semantic'`.

| ID    | Status | Step                                                 | Files                                                                                                               | Verification                      |
| ----- | ------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 3.5.1 | ✓      | Delete F10 (blocker)                                 | `engine/frameworks/integration/` (2 files, 869 lines)                                                               | `rg` → 0; knip no longer lists ✓  |
| 3.5.2 | ✓      | Narrow `analysisMetadata.mode` to `'minimal'`        | `shared/types/core-config.ts`                                                                                       | typecheck clean ✓                 |
| 3.5.3 | ✓      | Retire `isLLMEnabled` from port, impl, both branches | `shared/types/index.ts`, `content-analyzer.ts`, `prompt-analyzer.ts`, `prompt-lifecycle-processor.ts`, 4 test files | `rg -c "isLLMEnabled" src/` → 0 ✓ |

**Gate**: ✓ typecheck · lint:ratchet · typecheck:tests:ratchet · validate:arch · 8 further validators
exit 0; 1936 unit · 468 integration · 43 e2e; `verify:mcp` 12/12.

### The decision, and the evidence that settled it

Removing the flag forced a choice: do the two gated branches take the enabled or the disabled path?
Three measurements said **enabled**, and none of them is a preference:

1. **The gated capability never needed a model.** `GateAnalyzer.analyzePromptForGates` is entirely
   rule-based. The only LLM-dependent part was `confidence`, already hardcoded `0.0`.
2. **A sibling call site already ran it ungated** — `prompt-discovery-processor.ts:373` calls the
   identical method with no flag check. The gate was inconsistent, not protective.
3. **The flag defaulted false**, so both behaviors were dark for every user: everyone saw
   "⚠️ API Analysis Disabled" and nobody saw "💡 Suggested Gates", while the analyzer produced real
   output the whole time.

So this is not switching on something risky — it is removing an inconsistent gate that hid a
working, deterministic feature behind a flag for a subsystem that no longer exists. It remains a
**user-visible response-text change** and is recorded as one.

### Tests came first, and failed first

Neither branch had **any** test — `rg "API Analysis Disabled|Suggested Gates" tests/` returned
nothing, so the change would have been invisible to every gate. A new
`tests/unit/mcp-tools/resource-manager/prompt/prompt-analyzer.test.ts` was written against the
intended behavior and run against the **unchanged** source first: 2 of its 3 cases failed. That
failure is what makes them evidence rather than description. It uses a real `ContentAnalyzer`, not
a mock — the analyzer is pure, so a mock would only assert what it was told to return.

**Coverage gap — CLOSED in T3.6.** At the time this tier shipped, the `prompt-lifecycle-processor`
branch had no direct test and I recorded `all_criteria_mapped: partial — 1 of 2 branches directly
asserted`, judging a harness impractical because the processor "needs the full context plus file
writes."

**That judgment was wrong**, and the correction is worth keeping: I estimated testability from the
size of the surrounding class rather than from what the method under test actually reaches.
`createPrompt` touches five of `PromptResourceContext`'s nine fields plus `dependencies.onRefresh`,
and its only disk write is behind an injected `fileOperations.updatePromptImplementation` returning
a three-field result. Stubbing that one method leaves every analysis collaborator real — which is
the prescribed mock boundary, not the mock-everything shape I assumed I'd be forced into.
`all_criteria_mapped: complete — 2 of 2.`

---

## T3.6 ✅ COMPLETE 2026-08-05 — Close the icon and coverage debts · depends T3.5 · in `d219f8b7`

Two follow-ups requested directly, both deferrals this plan had recorded rather than resolved.

| ID    | Status | Step                                                           | Files                                                                             | Verification                                 |
| ----- | ------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------- |
| 3.6.1 | ✓      | Remove the unreachable arms from `getAnalysisIcon`             | `prompt-analyzer.ts`, `prompt-analyzer.test.ts`                                   | icon asserted identically before and after ✓ |
| 3.6.2 | ✓      | Build the missing `PromptLifecycleProcessor.createPrompt` test | `tests/unit/mcp-tools/resource-manager/prompt/prompt-lifecycle-processor.test.ts` | 4 cases; falsified by re-gating the branch ✓ |

**Gate**: ✓ typecheck · lint:ratchet · typecheck:tests:ratchet · validate:arch all exit 0.

### 3.6.1 — the probe found four dead arms, not the two named

The request named `'structural'` and `'hybrid'`. Probing every arm for a producer found two more:

- `'configurable'` is reachable only through the `|| framework` fallback, which needs `analysisMode`
  absent — and all three `PromptClassification` producers set it.
- `'disabled'` is dead because **`createDisabledAnalysisFallback` has zero callers**.

**The dead producer had to go with the dead arm.** Removing the `'disabled'` arm alone would leave
a method producing a value nothing renders; if anyone later wired it up, `'disabled'` would silently
render 🧠 instead of 🔧 — a behavior change planted by a cleanup. Same file, ~50 lines, mutually
dependent for their deadness, so they shipped together. Seven branches → one ternary with two
outcomes (🚨 when analysis threw, 🧠 otherwise).

Left alone: `framework: 'configurable'` at `:80` is a **producer**, not an arm, and `framework` has
a live reader at `prompt-engine/utils/classification.ts:61`.

**Verification shape differs from the earlier tiers on purpose.** This change is
behavior-_preserving_, so the icon assertions were written to pass **before as well as after** —
the invariance is the property being protected. Falsification then confirmed they discriminate: an
unconditional `'🧠'` body failed exactly the fallback case.

### 3.6.2 — the harness that was supposedly impractical

Four cases, real `PromptAnalyzer` / `ContentAnalyzer` / `GateAnalyzer`, one stub
(`updatePromptImplementation`). Both sides of the branch are pinned: suggestions present without a
`gate_configuration`, and suppressed with one.

**The fixture wording is load-bearing.** `GateAnalyzer.analyzePromptContent` matches
`/code|programming|function|class|method|variable/` to emit `code-quality`. A neutral fixture yields
an empty list, the `recommendedGates.length > 0` guard short-circuits, and an assertion on the
suggestions block would pass against a response containing nothing — proving the branch _didn't_
fire while claiming it did. The fixture says "Review this code function", and the test asserts the
gate id the **real** analyzer derived, not one the test supplied.

**Two discovery misses, both caught by running rather than reasoning.** `dependencies.onRefresh` is
reached from `handleSystemRefresh` _after_ the response is assembled, so Phase 1's "five fields"
enumeration was one short — the first run failed on it. And `typecheck:tests:ratchet` caught an
untyped `jest.fn()` whose `mock.calls[0]` is a zero-length tuple; `typecheck` alone could not see it,
which is the gap that ratchet exists to close.

**Falsified** by restoring the pre-T3.5 gating (`else if (false)`): exactly one test failed, the one
asserting the suggestions appear. The other three are branch-independent and correctly stayed green.

### What this does to T4

**The config section now has exactly one runtime reader left.** After 3.5.3, `rg llmIntegration
src/` outside config plumbing returns only `gate-validator.ts` (the `runLLMSelfCheck` stub) and the
`prompt-executor.ts:197` line that feeds it. That is precisely row **4.8**. T4 is now: decouple one
stub, then retire the config.

Also left alone deliberately: `getAnalysisIcon` still carries `'structural'` and `'hybrid'` arms
with no producer. They were dead before this work and are not caused by it. The `'semantic'` arm —
which this change _did_ invalidate — was replaced with an explicit `'minimal'` arm returning the
icon the `default` already produced, so intent is stated without altering behavior.

---

## T4 ✅ COMPLETE 2026-08-05 — Retire the config surface · depends T3, T0.1 · in `d219f8b7`

Shape depends on T0.1. Under the default (b):

| ID  | Status | Step                                                                                                                                                                                                             | Files                                                                                                 | Verification                                                         |
| --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 4.1 | ✓      | Mark the `analysis` section deprecated in the schema with the replacement named                                                                                                                                  | `config.schema.json`                                                                                  | `npm run validate:config-schema` ✓                                   |
| 4.2 | ✓      | Warn once at load when a config still carries `analysis.semanticAnalysis`                                                                                                                                        | `infra/config/index.ts`                                                                               | 4 unit tests, falsified twice ✓                                      |
| 4.3 | ✓      | Remove the MCP tool keys (**4**, not 5 — see count correction) + restart-required entry                                                                                                                          | `config-utils.ts`                                                                                     | `rg -n "llmIntegration" src/mcp/` → 0 ✓                              |
| 4.4 | ✓      | Remove the CLI keys (**5**, incl. `endpoint`) + restart entry + 5 validation cases                                                                                                                               | `config-input-validator.ts`, `config-operations.ts`, `cli/` (2 files)                                 | generator-vs-validator test still passes ✓                           |
| 4.5 | ✓      | Remove `analysis` from this repo's config                                                                                                                                                                        | `server/config.json`                                                                                  | `npm run validate:config-schema` ✓                                   |
| 4.6 | ✓      | Add the retired paths to the `INERT_SPELLINGS` retirement note, or state why they differ                                                                                                                         | `infra/config/index.ts`, `config-input-validator.ts`                                                  | **they differ** — rationale recorded at both sites ✓                 |
| 4.7 | ✓      | _(added at T3, done in T3.5)_ Resolve `isLLMEnabled()` — it reports the dying flag and gates user-visible response text in two places. Rename to what it actually gates, or retire it with `ContentAnalyzerPort` | `content-analyzer.ts`, `shared/types/index.ts`, `prompt-analyzer.ts`, `prompt-lifecycle-processor.ts` | the two branches produce the intended text under both flag states    |
| 4.8 | ✓      | _(added at T0.5 / F6)_ Decouple `runLLMSelfCheck` from `LLMIntegrationConfig` without deleting the `llm_self_check` gate type                                                                                    | `gate-validator.ts`, `gates/core/index.ts`, `prompt-executor.ts`                                      | `rg -n "LLMIntegrationConfig" src/engine/` → 0 ✓; gate suite green ✓ |

**Gate**: ✓ no setter for any `analysis.*` key on either surface (asserted per key against **both**
key lists, and against the validator's rejection — not just list membership); a config carrying the
section still loads, keeps its values, and warns exactly once.

Verified: typecheck · lint:ratchet · typecheck:tests:ratchet · 30 `validate:*` steps · 18
`*:self-test` steps all exit 0; 1950 unit · 484 integration; build clean; `verify:mcp` 12/12; the
three changed CLI flows driven end-to-end. `all_criteria_mapped: complete — 7 of 7.`

**One pre-existing red, not caused by this tier**: `validate:format` fails on
`.claude/rules/mcp-contracts.md` → **F12**. It is the third step of `validate:all`, so the wrapper
exits before reaching anything else — the 30+18 steps above were therefore run individually rather
than reported from a wrapper that never got to them.

### Count correction — the plan's inventory was wrong in both directions

The inventory line said "5 MCP tool keys (`config-utils.ts:32-35,43`), 1 CLI key". Measured:

| Surface                        | Settable keys | Restart entry | Validation cases |
| ------------------------------ | ------------- | ------------- | ---------------- |
| MCP (`config-utils.ts`)        | **4**         | 1             | 4                |
| CLI (`config-input-validator`) | **5**         | 1             | 5                |

The MCP surface never offered `endpoint`; the CLI did. And "1 CLI key" undercounted by four. The
line-number citation `32-35,43` was accurate and the prose was not — which is the argument for
re-measuring rather than trusting a plan's own arithmetic.

### Scope extensions, and why each was caused by this tier

None were adjacent-and-tempting; each was **created by** a row's edit:

- **`config-operations.ts`** (2 type-hint branches, 1 `boolKeys` entry). These describe how to
  coerce a key the validator no longer accepts — dead the moment 4.4 landed.
- **`cli/src/commands/enable-disable.ts`** (`SUBSYSTEM_MAP.analysis`). This is the sharpest one:
  the entry routes to the key 4.4 removed, so leaving it would have turned `cpm enable analysis`
  from a **no-op that reports success** into a **validation error**. Removing the setter without
  removing its caller doesn't preserve behavior, it degrades it. Verified by running the built
  binary: the command now reports `Unknown subsystem` and lists the real ones.
- **`cli/src/cli.ts`** help line. T1 marked `analysis` DEPRECATED here rather than deleting it,
  precisely so `SUBSYSTEM_MAP` would not advertise a hidden command "until T4". This is T4.
- **`legacy-key-migration.test.ts`**. Its "offers a canonical replacement for every key it dropped"
  loop asserted the canonical `…llmIntegration.enabled` key is settable. That invariant is now
  false by design, so the entry moved out of the loop into a test that states the exception and
  why — see below.

### The one dropped spelling with no canonical twin

Nine inert `*.mode` keys were deleted earlier because each had a working twin beside it. This one
had a twin too, and the twin has now been retired as well — so `analysis.semanticAnalysis` becomes
the first entry in `INERT_SPELLINGS` whose target is not settable.

That is why **4.6's answer is "they differ"** rather than "add them to the note". The inert
spellings were _never_ read; these keys _were_ read, correctly, until their reader was deleted.
Different defect, different retirement trigger: the `INERT_SPELLINGS` entry now retires **with the
config section**, not on the one-major-cycle schedule the rest of that table follows. Recorded at
the table entry, in the validator's header, and in the test that no longer asserts the twin.

The entry is deliberately kept alive meanwhile: a config written with `mode: "on"` must still
normalize to the single key the deprecation warning names, or the warning would tell a user to
remove a section whose spelling the loader refused to recognize.

### 4.8 — what "decouple" meant in practice

All three of `runLLMSelfCheck`'s config branches returned the same verdict (`passed: true`,
`score: 1.0`, `skipped: true`); only the message differed. So removing the config input could not
change what a gate does — it could only change what the skip _says_.

It changes that deliberately. The old text instructed the reader to
`set analysis.semanticAnalysis.llmIntegration.enabled=true` — a key that, as of 4.3/4.4, **neither
tool surface accepts**. A skip message that names an impossible remedy is worse than one that names
none, so it now points at `%judge` / `shell_verify`. Logged as a **user-visible text change**.

Two more directions in the same file pointed readers at the runner-less type — `runValidationCheck`'s
doc comment calling `llm_self_check` one of "the only valuable runtime validations", and the
auto-pass message recommending it. Both now name the types that actually run. These were stale
before this tier, but 4.8 is what put a flat contradiction three lines away from them.

The structural half is asserted by arity: `createGateValidator` and `GateValidator` both take 2
parameters, so there is no path by which config could reach the verdict. Arity is the only way to
assert an argument's _absence_.

**Falsified three times.** (1) Removing the once-guard failed exactly the "warns once per process"
test, leaving the other three green. (2) Removing the warning call failed that one **and** "warns
when a config still carries the section", still leaving "stays silent" and "still loads" green —
the two probes discriminate different properties. (3) Restoring the old config-key message failed
exactly "points at the live replacement", leaving acceptance, auto-pass and arity green. Probes
reverted; `rg FALSIFICATION src/ tests/ ../cli/src` → 0.

**The tests ratchet earned its keep again.** Four `TS18048` errors — `result.checks` is optional on
`ValidationResult`, and I indexed it without `?.` while the surrounding file already used `?.[0]`.
`typecheck` cannot see `tests/`, so this would have reached CI green.

### F11 — `ContentAnalyzer` is handed a config it never reads — CARRIED, then RESOLVED

**Moved to [reader-without-producer-sweep](./technical-debt/reader-without-producer-sweep-2026-08-05.md#f11)
and executed there 2026-08-06 (`558e4dc8`)** — the plumbing only. The prediction below that it
"has to survive until the removal major" was **wrong**: it bundled the internal plumbing with the
config types the parser still reads. Only the section itself waits for the major. Original text
kept below for the record.

`ContentAnalyzer` stores `SemanticAnalysisConfig` and exposes `getConfig`/`updateConfig`, and reads
no field from it: T3 removed the last one (the `llmIntegration` cache-key term). Both accessors have
**zero `src/` callers** — only tests. So `mcp/tools/index.ts:216 → getSemanticAnalysisConfig()` is a
live wire feeding a dead terminal.

Not executed here, and not merely for scope reasons: under T0.1 the section stays parsed for one
cycle, so this plumbing has to survive until the removal major regardless. It is genuinely a
next-cycle item, not a deferral of this one.

### F12 — `validate:format` was red on a file untouched since March — RESOLVED in T5

`.claude/rules/mcp-contracts.md` fails `npx prettier --check` while being **unmodified** relative to
`HEAD` (last commit `84b74cfa`, 2026-03-14). The diff is table alignment and one blank line — no
content. Since the file has not changed, the formatter's opinion of it did; `package.json` and
`package-lock.json` both carry uncommitted dependency changes this branch, which is the likely
mechanism.

It is the third step of `validate:all`, so **the whole CI contract stops there** — every gate after
it goes unrun, and a green local subset says nothing about them. Left unfixed on purpose: putting an
unrelated rules file in this tier's diff would break the tier-scoped commit boundary. Fix is
`npx --prefix server prettier --write .claude/rules/mcp-contracts.md` in its own commit.

Worth noting for the retirement-condition convention this repo follows: this is a gate that has been
failing without anyone's change causing it, which is the failure mode that makes a suite get ignored.

---

## T5 ✅ COMPLETE 2026-08-06 — Docs and a guard · depends T4 · in `d219f8b7` + `ff0273d9`

| ID  | Status | Step                                                                                                          | Files                                                                             | Verification                                         |
| --- | ------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 5.1 | ✓      | Point "semantic analysis" docs at `%judge` / `evaluation.defaultMode`                                         | `docs/guides/gates.md`, `docs/guides/cli.md` (**not** `mcp-tools.md` — see below) | **substituted** — the listed command is vacuous here |
| 5.2 | ✓      | CHANGELOG entry; if T0.1 chose (a), mark breaking per `CONTRIBUTING.md` §Breaking Changes                     | `CHANGELOG.md`                                                                    | not marked breaking — but see the open question      |
| 5.3 | ✓      | Guard against reintroduction — with a retirement condition, per the convention every other guard here follows | `server/scripts/validate-no-llm-client.js` (**renamed**) + `validate:all`         | 8 self-test rules + a real planted violation ✓       |

**Gate**: ✓ **`npm run validate:all` exits 0 — fully green**, which is better than this row asked
for: it was written expecting `validate:no-methodology-vocab` to stay red, and that guard was fixed
earlier in the session. `npm run verify:mcp` 12/12 on all 3 tools. `all_criteria_mapped: complete — 5 of 5.`

### 5.1's stated Verification is vacuous — substituted

`validate:documented-options` compares documented **CLI flags and `MCP_*` env vars** against the
parsers that declare them. It reads no config key, no gate criteria table, and none of the prose
this row rewrote. It passes identically before and after, so reporting it as this row's evidence
would be reporting a check that cannot observe the row's output.

Run anyway (it is cheap and guards a real class), and **substituted** with checks that do observe
the files: `prettier --check` on all three, `validate:readme`, and — for the substantive claim —
reading the source of the replacement being documented, below.

**`docs/reference/mcp-tools.md` needed no change.** The plan listed it; measured, it contains no
reference to semantic analysis, the `analysis` config, or the LLM client. Recorded rather than
edited, so the ✓ does not imply a file was touched that wasn't.

### The claim in these docs was verified against source, not assumed

Writing "`%judge` is the replacement" into three docs, a runtime message, and a guard is a claim
worth being wrong about. `mcp-tools.md:280` describes `%judge` as "Show guidance menu, don't
execute" — which would have made every one of those statements misleading.

Checked: both are true and they are different layers. `judge-menu-formatter.ts` serves the
command-level preview; `judge-prompt-builder.ts` builds the context-isolated evaluation prompt
("the judge sub-agent receives ONLY the output + criteria — no generation reasoning, chain history,
or framework context"), selected by `gates.evaluation.defaultMode: 'self' | 'judge'`
(`core-config.ts:211`). So the precise replacement is **judge mode**, reachable via `%judge`, and
the docs say that rather than naming the modifier alone.

### 5.3 — renamed, and why

The plan specified `validate-no-llm-sidecar.js`. Shipped as **`validate-no-llm-client.js`**:
`validate:no-legacy-sidecars` already exists and "sidecar" already means _a JSON state file SQLite
replaced_. Two guards whose names differ by one word while forbidding unrelated things is the exact
homonym trap `validate-no-execution-mode.js` documents avoiding. Named for what it forbids.

Shape: 10 zero-tolerance symbols, plus 2 config terms allowed only inside 4 allowlisted plumbing
files, each entry carrying a `closedBy`. Scoped to `src/` + `../cli/src`, **not** `tests/` — several
tests name the retired symbols in assertions that pin their _absence_, which is the retirement
working, not a violation of it.

**`GateValidationResult` is deliberately not forbidden** even though T2.5 deleted a type by that
name: a live, unrelated one exists at `prompt-engine/utils/validation.ts:28`. It was on my first
draft of the forbidden list and the measurement caught it — the same homonym failure the guard's
own name avoids.

**It has a satisfied-exception check.** An allowlist entry whose file no longer names the term, or
no longer exists, is reported as a finding. This repo has been bitten by the opposite six times in
one initiative: exceptions kept passing silently after the thing they excused was fixed.

**Writing that check is what found a bug in the guard.** Probing a deleted allowlisted file made it
**crash** — `ripgrep()` re-threw on rg's exit 2 (path not found) instead of reporting staleness. And
a deleted plumbing file is not a hypothetical: it is precisely what happens when the config section
is removed, i.e. the guard's own retirement event. Fixed to report both stale forms; both probed.

**Falsification**: 8 self-test rules all behave (5 catch, 3 accept); a violation planted in a real
file (`judge/types.ts`) was caught by the scanning path, not just the classifier; and both
stale-exception forms were probed against a modified copy. Tree left clean.

### Open question for the version decision — 5.2 did not mark this breaking, and that may be wrong

T0.1 decided "deprecate in place… no bump this cycle; major at removal." That reasoning was about
**the config section staying parsed**, which it does — no user's `config.json` breaks.

But T4 also **withdrew the setter keys** from both tool surfaces, which T0.1 never considered.
`CLAUDE.md` §Public API Contract names the CLI commands and the MCP tool surface as contract, and
its own precedent for `gate_verdict` reads: "the contract is the **union** of every reachable
shape… adding or removing a union member is [breaking]." A settable config key is close to a union
member, and `cpm enable analysis` now exits non-zero where it previously exited 0.

Mitigating: those invocations were **already semantically inert** — they set a flag whose readers
were dead. The break is an exit code, not a behavior.

I have written the CHANGELOG to describe the change plainly under **Changed/Removed** without a
breaking marker, because that matches T0.1 as decided. **Flagging rather than deciding**: whether
the setter withdrawal alone warrants the major bump is a release call, not a cleanup call.

---

## Risks

- **T3 rename touches four call sites across two layers.** `validate:no-crosslayer-relative` and
  `validate:arch` both have opinions; run them inside T3, not at the end.
- **`typecheck` is blind to `tests/`.** Every tier's gate must include `typecheck:tests:ratchet`
  or a signature change lands green against test files that no longer compile.
- **Deleting `getAnalysisConfig` / `getSemanticAnalysisConfig` changes the `ConfigManager`
  interface** (`shared/types/config-manager.ts`), which is internal — not contract surface — but
  is implemented in test doubles. Sweep `tests/` for mock shapes, per `cleanup-standards.md`
  §Test Surface Audit; `rg` on the source name will miss them.
- **Do not start T4 before T3 lands.** Removing the config the analyzer still reads yields a
  green typecheck and a runtime that reads `undefined`.
