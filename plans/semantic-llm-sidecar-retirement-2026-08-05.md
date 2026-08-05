---
title: "Semantic LLM Side-Client Retirement"
date: 2026-08-05
status: active
tags: [cleanup, gates, config, breaking-candidate]
---

# Semantic LLM Side-Client Retirement

**Status**: T0 decided · T1, T2, T2.5, T3 landed · T4–T5 pending · F9 + F10 filed for a dead-code tier
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

## T0 — Boundary decisions (no code)

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

## T1 — Delete the LLM side client · depends T0.1

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

## T2 — Delete `SemanticGateService` · depends T1

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

## T2.5 — Retire the orphaned validation channel · discovered at T2 · depends T2

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

### F9 — Two more reader-without-producer surfaces, different lineage (found while verifying 2.5)

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

## T3 — Collapse the analyzer · depends T2, T0.2, T0.3

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

Not deleted here: an 863-line subsystem removal is its own unit of review, and it is not a
sidecar artifact — it predates this plan. Filed with F9 for a dead-code tier. Deleting it is the
precondition for narrowing `mode`.

---

## T4 — Retire the config surface · depends T3, T0.1

Shape depends on T0.1. Under the default (b):

| ID  | Status | Step                                                                                                                                                                                               | Files                                                                                                 | Verification                                                      |
| --- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 4.1 | ☐      | Mark the `analysis` section deprecated in the schema with the replacement named                                                                                                                    | `config.schema.json`                                                                                  | `npm run validate:config-schema`                                  |
| 4.2 | ☐      | Warn once at load when a config still carries `analysis.semanticAnalysis`                                                                                                                          | `infra/config/index.ts`                                                                               | unit test asserts the warning                                     |
| 4.3 | ☐      | Remove the 5 MCP tool keys + restart-required entry                                                                                                                                                | `config-utils.ts`                                                                                     | `rg -n "llmIntegration" src/mcp/` → 0                             |
| 4.4 | ☐      | Remove the CLI key                                                                                                                                                                                 | `config-input-validator.ts`                                                                           | the generator-vs-validator test added this session still passes   |
| 4.5 | ☐      | Remove `analysis` from this repo's config                                                                                                                                                          | `server/config.json`                                                                                  | `npm run validate:config-schema`                                  |
| 4.6 | ☐      | Add the retired paths to the `INERT_SPELLINGS` retirement note, or state why they differ                                                                                                           | `infra/config/index.ts`                                                                               | —                                                                 |
| 4.7 | ☐      | _(added at T3)_ Resolve `isLLMEnabled()` — it reports the dying flag and gates user-visible response text in two places. Rename to what it actually gates, or retire it with `ContentAnalyzerPort` | `content-analyzer.ts`, `shared/types/index.ts`, `prompt-analyzer.ts`, `prompt-lifecycle-processor.ts` | the two branches produce the intended text under both flag states |
| 4.8 | ☐      | _(added at T0.5 / F6)_ Decouple `runLLMSelfCheck` from `LLMIntegrationConfig` without deleting the `llm_self_check` gate type                                                                      | `gate-validator.ts`, `prompt-executor.ts`                                                             | `rg -n "LLMIntegrationConfig" src/engine/` → 0; gate suite green  |

**Gate**: no setter for any `analysis.*` key on either surface; a config carrying the section still
loads and says so once.

---

## T5 — Docs and a guard · depends T4

| ID  | Status | Step                                                                                                          | Files                                                                       | Verification                               |
| --- | ------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------ |
| 5.1 | ☐      | Point "semantic analysis" docs at `%judge` / `evaluation.defaultMode`                                         | `docs/guides/gates.md`, `docs/guides/cli.md`, `docs/reference/mcp-tools.md` | `npm run validate:documented-options`      |
| 5.2 | ☐      | CHANGELOG entry; if T0.1 chose (a), mark breaking per `CONTRIBUTING.md` §Breaking Changes                     | `CHANGELOG.md`                                                              | —                                          |
| 5.3 | ☐      | Guard against reintroduction — with a retirement condition, per the convention every other guard here follows | `server/scripts/validate-no-llm-sidecar.js` + `validate:all`                | `--self-test` fails on a planted violation |

**Gate**: `npm run validate:all` green except the known-red `validate:no-methodology-vocab`;
`npm run verify:mcp` answers on all 3 tools.

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
