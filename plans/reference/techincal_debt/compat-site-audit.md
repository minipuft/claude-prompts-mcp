---
title: "Compat-Site Audit — Tier 4"
date: 2026-07-30
status: reference
tags: []
---

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

---

# 4.3 — execution layout (✓ EXECUTED 2026-07-30)

**Outcome**: 4.3a.1 ✓ (`47387639`), 4.3a.2 ✓ (`0ad5769e`), 4.3b ✓ but **not as written** —
see the correction below. 4.3c remains deliberately out of scope. Gate green after each commit:
typecheck 0 · 1696/1696 · `validate:all` 0 · `validate:arch` 0 · `build` 0 · ratchet 3478 → 3477.

Both 4.3a re-probes **held** under the widened search path, so the two surviving SPECULATIVE
verdicts were correct. 4.3b's did not — a **third** authored claim in this file turned out to be
wrong, from the same root cause as the first three:

> **4.3b correction.** The claim "`prompt-schema.ts:33` and `shared/types/index.ts:143` —
> 'Removed in v3.0.0'; the enum they describe is already gone" is **false**. `allowedValues` was
> never removed. It is declared in **three** places (`prompt-schema.ts:36`,
> `shared/types/index.ts:145`, `mcp/tools/types/shared-types.ts:303` — the third carried no notice
> at all), still accepted in prompt YAML, and still copied into the runtime validation object at
> `yaml-prompt-loader.ts:350-351`. What v3.0.0 dropped is **enforcement**:
> `argument-schema.ts:157,196` deliberately skip the constraint and
> `argument-schema-validator.test.ts:388` asserts it. So these were not deletable stale comments —
> they were **inaccurate comments on live fields**, the same defect class as the misattached
> `@deprecated` blocks fixed in `9d8cbe2f`. Reworded rather than deleted (`ae6da7fd`).
>
> The `script-schema.ts:57,59` `ExecutionModeSchema` notice was likewise **left alone**: `:122`
> consumes the schema in a working migration transform that emits a deprecation warning. That
> notice is accurate and load-bearing.

**Running tally: 4 of the 5 SPECULATIVE-or-stale verdicts in this file that were checked have been
falsified.** Every one rested on authored prose or a `src`+`tests` consumer count. The method note
at the bottom is not optional advice — it is the finding.

---

## Original layout (approved 2026-07-30)

**Read this before touching anything.** Laying 4.3 out precisely re-probed the five SPECULATIVE
rows above and **falsified three of them**. The corrections are below and supersede the earlier
table. The original probes searched `src` and `tests` only; two of the three misses were outside
that path, and one was a value that _is_ read, on a line the consumer-count did not distinguish.

## Corrections to the 4.1 verdicts

| Site                                                                                        | Was                     | Now                        | Why                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | ----------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp/contracts/schemas/types.ts:79` — `toolDescription`                                     | SPECULATIVE             | **LOAD-BEARING**           | Declared in **all four** contract JSONs (`prompt-engine`, `resource-manager`, `system-control`, `skills-sync`). The probe searched `src`/`tests` and missed `tooling/contracts/`. Removing the schema field would silently drop authored data. |
| `engine/gates/registry/gate-provider-adapter.ts:117` — `clearCache()`                       | SPECULATIVE             | **STRUCTURAL**             | `GateDefinitionProvider` **declares** `clearCache(gateId?: string): void` at `engine/gates/core/gate-loader.ts:32`. The empty body is an interface obligation, not dead code. Retiring it means changing the interface.                        |
| `engine/frameworks/prompt-guidance/template-enhancer.ts:21` — `enableStructureOptimization` | SPECULATIVE             | **LOAD-BEARING**           | Read at `template-enhancer.ts:62`: `if (this.config.enableStructureOptimization && !template.startsWith('##'))`. It gates behaviour.                                                                                                           |
| `mcp/tools/system-control/system-control-router.ts:103` — `setToolDescriptionLoader`        | SPECULATIVE (6 callers) | **SPECULATIVE (narrower)** | Only the _system-control override_ is an empty sink. `prompt-executor.ts:288` and `mcp/tools/index.ts:261` are real implementations. Scope is 2 sites, not 6.                                                                                  |

**Surviving SPECULATIVE: 2, not 5.**

## Step 4.3a — remove the two confirmed SPECULATIVE sites ✓

One commit each. Both are additive-free deletions with no behaviour change.

**4.3a.1 — `enableArgumentSuggestions` (dead flag).** Set in four places, read in none. Contrast
with its sibling `enableStructureOptimization`, which IS read at `template-enhancer.ts:62` — do not
remove that one.

Delete the field and every assignment:

- `engine/frameworks/prompt-guidance/template-enhancer.ts:20` (declaration), `:36` (default)
- `engine/frameworks/prompt-guidance/service.ts:31` (declaration), `:83` (default)
- `mcp/tools/prompt-engine/core/prompt-executor.ts:575`
- `tests/helpers/test-helpers.ts:389`

Verify: `rg -nw enableArgumentSuggestions src tests` returns 0; `typecheck`; `test:ci`.

**4.3a.2 — the `setToolDescriptionLoader` sink.** Delete the empty override at
`system-control-router.ts:103-105` and the optional call at `mcp/tools/index.ts:267`
(`this.systemControl.setToolDescriptionLoader?.(manager);`). Leave `:261` and
`prompt-executor.ts:288` alone — those do real work.

Verify: `rg -nw setToolDescriptionLoader src` shows only the two real implementations plus
`module-initializer.ts:237`; `typecheck`; `test:ci`.

## Step 4.3b — stale comment cleanup (zero risk, no approval needed) ✓ — see correction above

**Two were already fixed during this layout** and are NOT pending:
`methodology-types.ts:296` and `:378` carried `@deprecated Use type instead` blocks that were
orphaned when the `methodology` member was removed. They had re-attached to `readonly version:
string` and `abstract readonly version: string`, marking **`version` itself as deprecated** — false,
and an IDE renders it struck through. Removed.

**Correction to commit `bb1f590a`:** its message says the field was removed from
`FrameworkDefinition`. It was not. `FrameworkDefinition.methodology` still exists at
`methodology-types.ts:62`. What that commit removed was `FrameworkResourceDefinition.methodology`
(`methodology-definition-types.ts`), the `FrameworkGuide` interface member, and the abstract member.
The remaining live deprecated `methodology` fields are:

| Site                                              | Type                                   | Still live?              |
| ------------------------------------------------- | -------------------------------------- | ------------------------ |
| `engine/frameworks/types/methodology-types.ts:62` | `FrameworkDefinition.methodology`      | **yes** — mirrors `type` |
| `mcp/tools/framework-manager/core/types.ts:246`   | creation-payload `methodology: string` | **yes**                  |
| `engine/frameworks/utils/template-enhancer.ts:37` | local alias type                       | **yes**                  |

Retiring these is a **follow-on to `bb1f590a`, not a comment cleanup** — each needs its consumers
repointed to `type` first. Do not delete the comments while the fields they describe still exist.

> **✓ DONE 2026-07-30** — `a5ef4043` (internal) + `e2b632c2` (contract-crossing). Gate green on
> both: typecheck 0 · 1703/1703 · `validate:all` 0 · `validate:contracts` 0 · `validate:arch` 0 ·
> `build` 0.
>
> **The table above says three fields. Probing found FIVE declarations spanning THREE concepts** —
> and only three of the five were the deprecated mirror. Splitting them was the whole job:
>
> | Concept                                                                                                                                                                                                         | Sites                                                                                                                                                                                                                                                                                                                   | Verdict             |
> | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
> | Deprecated mirror of `type`                                                                                                                                                                                     | `methodology-types.ts:62` (`FrameworkDefinition`), `fm/core/types.ts:246` (`FrameworkCreationData`), `template-enhancer.ts:37` (enhancement subset) — plus two structural subset types the table missed entirely: `FrameworkStateAccessor.getActiveFramework` and `chain-operator-executor`'s `selectedFramework` shape | **Retired**         |
> | `enhancementMetadata.methodology` (`methodology-types.ts:170`)                                                                                                                                                  | a metadata label written from `this.type`                                                                                                                                                                                                                                                                               | **Homonym — kept**  |
> | Gate criteria `methodology` (`gate-schema.ts:88`, `gate-definition-schema.ts:115`, `gate-hot-reload.ts:250`) and `MethodologyFileData.methodology` (the parsed-YAML container, `methodology-file-writer.ts:36`) | unrelated domains that merely share the word                                                                                                                                                                                                                                                                            | **Homonyms — kept** |
>
> `FrameworkMethodology` (`FrameworkType \| 'AUTO'`) also survives. It is deprecated too, but it
> still carries the `'AUTO'` selection value across eight live consumers, so retiring it means
> handling AUTO first — a separate job, not this one.
>
> **A defect of mine surfaced here**: `436e2d57`'s contract sweep also caught the parameter's
> `name` field, so `resource-manager.json` advertised `framework` while the Zod schema still said
> `methodology`. An LLM following the tool description would have sent a key the schema rejects.
> Resolved in the direction the contract already pointed — every layer now names `framework`, and
> the wire-name → service-field (`type`) derivation is explicit and commented at the
> `FrameworkManagerInput` → `FrameworkCreationData` boundary rather than hidden in the router.
> `router.ts:127` was also still telling users an action was `only valid for resource_type:
"methodology"`, with a test pinning the wrong string.

Genuinely stale prose, safe to delete:

- `modules/prompts/prompt-schema.ts:33` and `shared/types/index.ts:143` — "Removed in v3.0.0"; the
  enum they describe is already gone
- `modules/automation/core/script-schema.ts:57,59` — `ExecutionModeSchema` deprecation notice, kept
  accurate only if the schema survives; check `script-schema.ts:64/:122` first, which are live
  consumers

## Step 4.3c — STRUCTURAL rows (explicitly NOT 4.3 work)

The 18 STRUCTURAL rows are Tier-2-style consumer repointing. Doing them under a "compat cleanup"
label is how a shim sweep breaks a build. Largest first, each its own tier-sized job:
`PromptData` (84 consumers), `GatesConfig` (21), `ChainStep` (24), `LightweightGateDefinition`
(106 — arguably not a shim at all at that usage level).

## Do not touch

The 14 behavioural fallbacks. Two fail **closed and silently**:
`injection-decision-service.ts:366` (injection denied) and `gates/core/index.ts:139` (gates
disabled). A regression in either emits no error and simply produces less behaviour.

## Method note for whoever picks this up

Every verdict in 4.1 that rested on a consumer count of `src` + `tests` alone proved unreliable:
`tooling/contracts/`, interface declarations, and read-sites on conditional lines were all missed.
Before deleting anything here, re-probe with the search path widened to the whole repo and confirm
the symbol is neither declared by an interface nor read inside a conditional.
