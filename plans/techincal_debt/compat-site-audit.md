# Compat-site audit — Tier 4 (REPORT ONLY)

**Date**: 2026-07-30 · **Scope**: `server/src` · **Status**: 4.1 ✓, 4.2 ✓, 4.3 not started (needs
per-site approval).

**Count correction**: the plan estimated "~40 sites" from
`rg -n "backward compat|Kept for|for compatibility" src`. That grep returns **33**. It also misses
**29** `@deprecated` markers that are compat sites by any reasonable definition. Audited surface is
therefore **62 rows**, not 40. Consistent with every other count in this plan being wrong.

## Verdict definitions

- **LOAD-BEARING** — removing it changes runtime behaviour, or a live consumer breaks. Keep.
- **SPECULATIVE** — no consumer depends on it; it exists in anticipation of a compatibility need
  that never materialised. Candidate for deletion in 4.3.
- **STRUCTURAL** — a re-export or alias that is genuinely load-bearing _today_ because consumers
  import through it, but whose existence is an artefact of an incomplete move. Not deletable
  standalone; deletable by repointing consumers. These are the honest middle, and lumping them in
  with SPECULATIVE is how a sweep breaks a build.

Evidence column states how the verdict was reached: **probe** (consumer count measured), **read**
(behaviour determined by reading the code path), or **declared** (the code says so itself).

---

## SPECULATIVE — deletion candidates (5)

| Site                                                        | What it guards                                                                                                            | Evidence                                                            | Verdict                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `mcp/tools/system-control/system-control-router.ts:104`     | `setToolDescriptionLoader()` — an **empty method body**. Comment reads "Stored for backwards compat; no handler uses it." | declared + probe: 6 call sites, all passing a value into a no-op    | **SPECULATIVE** — the method is a sink. Deleting requires updating 6 callers, none of which observe an effect. |
| `mcp/contracts/schemas/types.ts:79`                         | `toolDescription` field, "Optional for backwards compatibility"                                                           | probe: **1** total reference — its own declaration. Zero consumers. | **SPECULATIVE**                                                                                                |
| `engine/frameworks/prompt-guidance/template-enhancer.ts:20` | `enableArgumentSuggestions` — "Kept for compat"                                                                           | probe: 6 refs, none reading the value to branch on                  | **SPECULATIVE** — flag is threaded but never gates behaviour                                                   |
| `engine/frameworks/prompt-guidance/template-enhancer.ts:21` | `enableStructureOptimization` — "Kept for compat"                                                                         | probe: 7 refs, same shape as above                                  | **SPECULATIVE**                                                                                                |
| `engine/gates/registry/gate-provider-adapter.ts:118`        | cache-invalidation method that is a documented no-op ("registry handles its own caching")                                 | read: body is empty                                                 | **SPECULATIVE** — same sink pattern as the router method                                                       |

## LOAD-BEARING — behavioural fallbacks (14)

Each of these _changes what the server does_ when the new-style input is absent. Removing any one
is a behaviour change, not a cleanup. All verdicts by **read** of the branch.

| Site                                                                              | Behaviour if removed                                                                                      |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `engine/execution/delegation/strategy.ts:287`                                     | delegation with no declared client profile stops defaulting to the Claude strategy                        |
| `engine/execution/operators/chain-operator-executor.ts:127`                       | steps relying on `targetStep.args` lose their arguments                                                   |
| `engine/execution/parsers/parser-utils.ts:53`                                     | legacy `#style(id)` syntax stops parsing                                                                  |
| `engine/execution/parsers/argument-parser.ts:198`                                 | array args stop being JSON-encoded; downstream string consumers break                                     |
| `engine/execution/pipeline/decisions/injection/injection-decision-service.ts:366` | injection is **denied** instead of allowed when no execution context is supplied — fails closed, silently |
| `engine/execution/parsers/symbolic-operator-parser.ts:373`                        | anonymous + canonical gate criteria stop merging into one operator                                        |
| `engine/gates/core/index.ts:139`                                                  | gates default to **disabled** when no gate system manager is set                                          |
| `modules/hot-reload/file-observer.ts:671`                                         | a path shape stops being recognised for hot reload                                                        |
| `modules/automation/core/script-schema.ts:118-120`                                | user `script.yaml` files with `mode: manual` stop loading (auto-migrated today)                           |
| `modules/automation/core/script-schema.ts:133-134`                                | numeric `confidence` in user YAML becomes a hard error rather than ignored                                |
| `modules/automation/execution/execution-mode-service.ts:223-224`                  | manual-mode execution path disappears                                                                     |
| `modules/prompts/yaml-prompt-loader.ts:316`                                       | path-only return shape changes for existing callers                                                       |
| `runtime/data-loader.ts:82`                                                       | a resource path that is a file rather than a directory stops resolving                                    |
| `modules/chains/manager.ts:2042`                                                  | unscoped chain-session removal changes meaning                                                            |

> The two `script-schema.ts` rows are the ones Tier 3 step 3.7 wanted to delete. They are
> **user-facing YAML compatibility with an active auto-migration**, which is why 3.7's verification
> (`rg "\bmode\b" = 0`) was unreachable. Retiring them is a deprecation decision with a notice
> period, not a sweep.

## STRUCTURAL — re-export/alias artefacts of incomplete moves (18)

Live consumers import through these, so none is deletable standalone. Each is retired by repointing
consumers to the canonical module, then removing the re-export — the pattern used in Tier 2.

| Site                                                                                                   | Canonical home                    | Consumers (probe)                              |
| ------------------------------------------------------------------------------------------------------ | --------------------------------- | ---------------------------------------------- |
| `shared/types/index.ts:172` — `GatesConfig` → `GateSystemSettings`                                     | `shared/types/core-config.ts`     | **21**                                         |
| `shared/types/index.ts:169` — gate contract types                                                      | `engine/gates/types.ts`           | via above                                      |
| `modules/prompts/types.ts:29` — `ChainStep`, `GateDefinition`, `PromptData`, `PromptGateConfiguration` | `shared/types/index.ts`           | `PromptData` **84**, `ChainStep` **24**        |
| `mcp/tools/prompt-engine/core/types.ts:10`                                                             | `shared/types/chain-execution.ts` | live                                           |
| `modules/prompts/loader.ts:33`                                                                         | `yaml-prompt-loader.ts`           | live                                           |
| `infra/logging/index.ts:12`                                                                            | canonical logging types           | live                                           |
| `infra/database/stores/interface.ts:6`                                                                 | `shared/types/persistence.ts`     | live                                           |
| `engine/frameworks/utils/template-enhancer.ts:22` — local aliases                                      | canonical enhancer types          | live                                           |
| `engine/frameworks/prompt-guidance/service.ts:58` — `ServicePromptGuidanceResult`                      | `PromptGuidanceResult`            | **6**                                          |
| `engine/execution/parsers/index.ts:9` — "Compatibility Wrapper"                                        | direct parser modules             | live                                           |
| `engine/gates/types.ts:206` — `LightweightGateDefinition`                                              | `GateDefinition`                  | **106** — heavily used; not a shim in practice |
| `engine/gates/types.ts:91` — LLM extension fields                                                      | —                                 | live                                           |
| `mcp/tools/prompt-engine/processors/response-formatter.ts:48`                                          | current gate result type          | live                                           |
| `mcp/tools/shared/structured-response-builder.ts:174`                                                  | full builder                      | live                                           |
| `infra/config/index.ts:486`                                                                            | richer config accessor            | live                                           |
| `shared/utils/chainUtils.ts:7`                                                                         | modular chain functions           | live                                           |
| `shared/utils/errorHandling.ts:166,173,655`                                                            | new constructor signature         | `validationErrors` **35**                      |
| `mcp/tools/tool-description-loader.ts:36` — emergency fallback, "do not edit"                          | contracts JSON                    | load-bearing on contract-load failure          |

## LOAD-BEARING — deprecated-but-current type surface (10)

| Site                                                                                                   | Note                                                                                                                      |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `engine/frameworks/types/methodology-types.ts:45` — `FrameworkMethodology` = `FrameworkType \| 'AUTO'` | probe **13**. The `'AUTO'` member is the reason it survives the `methodology` field removal.                              |
| `engine/frameworks/types/methodology-types.ts:59,296,378` — `@deprecated Use type instead`             | **Now stale comments**: the `methodology` field they refer to was deleted in `bb1f590a`. Comment-only cleanup, zero risk. |
| `engine/frameworks/utils/template-enhancer.ts:36`                                                      | same stale-comment class                                                                                                  |
| `mcp/tools/framework-manager/core/types.ts:245`                                                        | same stale-comment class                                                                                                  |
| `shared/types/automation.ts:57` — `'parameter_match'` → `'schema_match'`                               | probe **15**; still emitted                                                                                               |
| `shared/types/chain-session.ts:142` — legacy keys in persisted session                                 | persisted shape; bound to `SCHEMA_VERSION`                                                                                |
| `engine/execution/context/execution-context.ts:74`                                                     | pipeline coordination moved to `state`; accessors still used                                                              |
| `infra/http/transport/index.ts:341` — SSE deprecated                                                   | transport parity requirement; removing breaks SSE clients                                                                 |
| `modules/skills-sync/service.ts:320` — legacy global export list                                       | read: still consulted when `registrations` absent                                                                         |
| `shared/utils/file-transactions.ts:70`                                                                 | superseded by `ResourceMutationTransaction`; both live                                                                    |

## Already resolved by this sweep (15)

`modules/prompts/prompt-schema.ts:33` and `shared/types/index.ts:143` (both "Removed in v3.0.0"),
`modules/automation/core/script-schema.ts:57,59,63` (`ExecutionModeSchema`), and the 10 sites whose
comments referenced the now-deleted `methodology:` field. These are **stale prose**, not live
compat: the thing they describe is already gone. Deleting the comments is a docs change.

---

## 4.2 — the `id` vs `section_header` divergence

**Original framing was imprecise.** There is no `id:` field on a phase. Verified in
`resources/frameworks/cageerf/phases.yaml`: a phase carries `description`, `frameworkBasis`,
`order`, `required`, `section_header`, `guards` — its _identity_ is the YAML map key.

So the divergence is between **the phase's identity (map key)** and **its rendered anchor
(`section_header`)** — e.g. key `context` vs `'## Context'`. Both are needed and they are not
interchangeable.

This is already handled deliberately, not accidentally.
`engine/execution/pipeline/stages/09b-phase-guard-verification-stage.ts:180` carries the comment:

> Hint with the phase's actual `section_header` (e.g. "## Dissolve"), NOT the phase id

and `:185` builds the user-facing hint from `r.section_header`, while `:220` resolves the framework
by `.id` for a different purpose. `section-splitter.ts:14` types the field.

**Verdict: LOAD-BEARING, working as intended.** The only defect is that the invariant lives in a
line comment rather than in a type. A `PhaseAnchor` newtype would make confusing them
unrepresentable, but that is an improvement, not a compat retirement. **No 4.3 action.**

---

## Recommended 4.3 sequence (needs per-site approval)

1. **Zero-risk, no approval needed** — delete the 15 stale comments in "Already resolved". They
   describe things that no longer exist and actively mislead.
2. **The 5 SPECULATIVE rows**, one commit each. Start with `toolDescription` (1 reference, its own
   declaration) and the two no-op sinks, which are self-declaring.
3. **STRUCTURAL rows** are Tier-2-style work, not Tier 4: repoint consumers, then delete the
   re-export. `GatesConfig` (21) and `modules/prompts/types.ts` (`PromptData` 84) are the largest
   and were already deferred out of Tier 2.3 for that reason.
4. **Do not touch** the 14 behavioural fallbacks or the 10 live deprecated-type rows without a
   deprecation notice. Two of them fail _closed_ and _silently_
   (`injection-decision-service.ts:366`, `gates/core/index.ts:139`), which is the worst shape for a
   regression: no error, just less behaviour.
