---
title: "P7 — Resource authoring efficiency (patch-mode update + four write-path defects)"
date: 2026-08-12
status: active
tags:
  [adaptive-chain-runtime, resource-manager, versioning, mcp-contracts, prompts]
---

# P7 — Resource Authoring Efficiency: Implementation Plan

**Master plan**: `adaptive-chain-runtime-2026-08-09.md` §P7 · closes defects **P7-D1 … P7-D4**
**Produced by**: `chain-implementation_plan#5` (Discovery → Design → Verify-Paths → Plan-Table → Completion), 2026-08-12
**Sibling notes**: `adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementation-notes.md` (rulings, deviations, validation ledger)

## Intent

- **Work type**: bug_fix · **secondary**: feature (patch-mode)
- **Problem**: editing a prompt costs tokens proportional to the whole prompt rather than to the change; and the write path silently discards or mislabels what it persists.
- **Risk**: high — `version_history` is a DURABLE table whose rows nothing regenerates; `resource_manager` is in the Public API Contract; 45 prompt files currently carry `required: true`.
- **External deps**: none.
- **Confidence**: high.
- **Acceptance**: (a) a one-section prompt edit is expressible without transmitting the untouched sections; (b) it is rejected cleanly on template-syntax error, without writing and without consuming a version; (c) it produces the same `version_history` entry a full update would.

## Constraints (bind every tier)

- MCP tooling only for prompt resources — direct file edits under `server/prompts/**` and `server/resources/prompts/**` are forbidden (loader/writer contract + `version_history`).
- Contracts as SSOT. Never edit `_generated/`; regenerate via `npm run generate:contracts`.
- Public API Contract: `resource_manager` parameter and response changes are **in-contract**. Additions to the union are non-breaking; removals are breaking.
- Validation minimum: `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci`. Add `validate:contracts` for any schema change, and both SQLite gates (`validate:table-contracts`, `validate:no-phantom-columns`) if versioning storage is touched.
- Docs lockstep: `docs/reference/mcp-tools.md`.
- Never commit without approval.
- **P7-D2 touches DURABLE data.** `version_history` holds rollback snapshots nothing regenerates. Any migration or backfill design must respect `.claude/rules/sqlite-persistence.md` durable-table rules — snapshot/restore by column intersection, no engine-resident one-time migration code, and a `NOT NULL` column with no default makes the restore throw by design.

## Discovery (step 1, measured)

**Ownership**: tool input validation → hand-written Zod `src/mcp/tools/schemas/resource-manager.schema.ts`. Descriptions/metadata → `tooling/contracts/resource-manager.json` → `generate:contracts` → `_generated/`. Prompt CRUD → `PromptLifecycleProcessor`; disk write → `PromptFileOperations`. Versioning → `VersionHistoryService` (durable `version_history`), second writer `cli-shared/version-history.ts`. Prompt YAML contract → `prompt-schema.ts`.

**Sibling patterns**:

- `chain_steps` uses `ChainStepSchema.passthrough()` (schema:79/85) which PRESERVES unknown keys; `arguments` uses a bare `z.object()` which STRIPS them. Same file, ten lines apart — the D1 fix precedent.
- `chain_step_operation` add/remove/reorder/replace (schema:81-87 → `applyChainStepOperation`) is the existing sub-field-addressed write precedent; patch mode mirrors its shape.
- `skills-sync/service.ts:1403-1541 parseSkillMd` already does section-addressed parse/merge over prompt content. Different domain and heading vocabulary — recorded as the v2 reuse target, not used in v1.
- `processTemplate` (jsonUtils.ts:165) / `processTemplateWithRefs` (:311) — dry-run render entry. `validatePromptYaml` (prompt-schema.ts:540) — validation entry. `PromptReferenceValidator` already runs on template change (lifecycle-processor:282).

### Root causes

**P7-D1 — single-site, schema-side.** `resource-manager.schema.ts:69-77` accepts `z.array(z.object({name, type, description}))`. Zod strips unknown keys by default, so `required` is discarded at the FIRST boundary — before router, processor or file-operations see it. Everything downstream is faithful pass-through (`router.ts:145` → `lifecycle-processor.ts:117` create, `:241/:247-251` update → `file-operations.ts:296-297`). Three layers already carry the field and only the validator does not:

| Layer                                        | State                                                  |
| -------------------------------------------- | ------------------------------------------------------ |
| contract `resource-manager.json:87-88`       | declares `array<{name,required?,description?,type?}>`  |
| `resource-manager/core/types.ts:124`         | declares `required?: boolean`                          |
| loader `prompt-schema.ts:57/61`              | `required: z.boolean().default(false)`, `defaultValue` |
| **tool Zod `resource-manager.schema.ts:69`** | **absent — strips**                                    |

Secondary drifts at the same site: `type`/`description` are non-optional tool-side but optional loader-side; `defaultValue` unrepresented; tool `type` is `z.string()` vs the loader's 5-value enum. **Blast radius: 45 prompt files carry `required: true`.**

**P7-D1 widening (P7-F2).** `file-operations.ts:291-313` writes 10 keys; `PromptYamlSchema` (prompt-schema.ts:427-490) accepts 17. Silently dropped on every update: `injection`, `registerWithMcp`, `mcpPromptMode`, `subagentModel`, `agentType`. `registerWithMcp` measured present in 4 prompt files; `subagentModel`/`agentType` govern `==>` delegation, so the loss is behavioral.

**P7-D2 — three independent mechanisms, none of which is "snapshot drift".**

1. _Before-snapshot numbering._ `lifecycle-processor.ts:315-323` passes `beforeContent` (captured :211, the state BEFORE the edit) to `saveVersion`, which labels it `max+1` (`version-history-service.ts:137`). Version N holds the state before update N; **no version row ever holds current live content.** `history` renders "6 (latest) +54/-20" — a version number that reads like a state beside a diff describing the transition _out_ of it.
2. _Rollback is a hybrid merge._ `prompt-versioning-processor.ts:114-121` builds `snapshot['k'] ?? currentPrompt.k` across all 8 keys. A key missing or null in the snapshot silently keeps the LIVE value, so the result matches neither the target version nor the current state.
3. _Rollback bypasses the update write model_, writing only those 8 keys, dropping the same 5 fields as P7-F2.

_Live reproduction_ (`action:"history" id:"implementation_plan"`): v4 = "Pre-rollback snapshot (before reverting to v1)", Aug 11 11:48 PM. Mechanism 1 fully explains the charter's "reverted past an entire prior migration".

**P7-D3 — re-scoped.** `resources/prompts/planning/implementation_plan/prompt.yaml:70,72,74,76,78` (5 labels) + `.../implementation_plan/discovery/prompt.yaml` (1). The `(Phase N)` strings in `development/dev-workflow/*` and `analysis/notes/vault_notes/*` are the dev-loop's own legitimate phases and must NOT be swept.

**P7-D4 — larger than charter states.** `file-operations.ts:74` slugifies `category`, `:90-94` `mkdir`s it; nothing in the write path reads `.gitignore`. Census: 13 of 17 on-disk categories entirely untracked (analysis 19, development 32, planning 6, resume 9, knowledge-capture 5, pr-review 5, general 6, content_processing 3, creative 2, debugging 1, documentation 2 — all 0 tracked). `planning/implementation_plan/prompt.yaml` — the chain that produced this plan — is gitignored (`git check-ignore` → `.gitignore:2`).

### Premise corrections (untrusted-inventory)

1. **Field-level merge already exists.** `UPDATE_FIELDS` (validation.ts:18-32) + `lifecycle-processor.ts:234-251` rebase from the current prompt and override only supplied keys. An update touching only `description` already does NOT retransmit the template. The correct problem statement is missing **sub-field (intra-template) addressing**, not missing field-level merge.
2. **The chain-management backlog memory is stale on 2 of 4 gaps.** Gap 1 (no step-level CRUD) is CLOSED — `chain_step_operation` exists. Gap 2 (`z.array(z.unknown())`) is CLOSED — now `z.array(ChainStepSchema.passthrough())`.
3. **D3 depends on D4** — the target file is gitignored, so relabelling produces no committable diff until D4's disposition is ruled.
4. **Tree-state assertion corrected** — see Verify-Paths.

## Design (step 2)

**Objective**: make a prompt edit cost tokens proportional to the change, and stop the write path from silently discarding or mislabeling what it persists.

**Non-goals**: gate/framework patch mode (prompt-only v1); step-level chain CRUD beyond D3's labels; section-addressed patching if anchored addressing ships (OQ-P7-1); renumbering existing `version_history` rows unless OQ-P7-3 rules for it; changing the symbolic command language.

**Pre-flight**: probed, not recalled. **2 failures → compound: persistence + contracts → Interface contract violation → fix the contract, not the symptoms.**

| Check                 | Result                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| domain                | pass — PromptLifecycleProcessor owns prompt CRUD; VersionHistoryService owns `version_history`. PROBE: one prompt write-path `saveVersion` call site (lifecycle-processor.ts:315)                                                                            |
| layer                 | pass — patch application is a pure transform; processor stays orchestration                                                                                                                                                                                  |
| naming                | pass — `applyTemplatePatches` / `TemplatePatchOperation` / `PatchRejection` name behavior                                                                                                                                                                    |
| complexity            | pass — PROBE: `npx eslint` on all four targets → 195 problems, ZERO `sonarjs/cognitive-complexity` violations                                                                                                                                                |
| size                  | pass (diagnostic) — 478 / 483 / 424 / 195 lines, one responsibility each                                                                                                                                                                                     |
| service               | pass — PROBE: `skills-sync/service.ts:1403` is section-addressed but serves skill export; not extended in v1                                                                                                                                                 |
| defined               | resolved by reading — `required` is ALREADY defined at three layers; the fix stops the strip, it does not add a fourth copy                                                                                                                                  |
| **contracts**         | **FAIL** — tool Zod disagrees with contract, `core/types.ts`, and the loader on `required`, `defaultValue`, optionality, and the type vocabulary                                                                                                             |
| pattern               | pass — OOP shell + FP internals preserved                                                                                                                                                                                                                    |
| reuse-scope           | pass with note — operation type defined generically so gate/framework widening is additive                                                                                                                                                                   |
| **persistence**       | **FAIL** — version save is log-and-swallow: `version-history-service.ts:186` catches, `lifecycle-processor.ts:330-334` logs a warning and PROCEEDS. A failed snapshot yields a silent gap on a durable table while the operator is told the update succeeded |
| lib-api / lib-version | n/a — no external library                                                                                                                                                                                                                                    |

**Identification** (for the one new module): behavior = given current field text and ordered anchored replacements, produce either the new text or a typed rejection naming which anchor failed and why. State = none. Shape = module of pure functions (derived from state:none). Placement = `resource-manager/prompt/operations/template-patch.ts`; consumers = `PromptLifecycleProcessor` only.

### Decisions

| Decision            | Chosen                                                                          | Rejected                                     | Why                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 fix site         | tool Zod schema                                                                 | processor-side re-injection; `passthrough()` | strip happens at the first boundary; re-injection papers over a validator that still lies; `passthrough()` admits arbitrary keys into persisted YAML |
| D1 scope            | whole write-path field-loss set                                                 | `required` alone                             | 10 of 17 fields written; fixing one flag leaves four behavioral fields lossy                                                                         |
| Patch addressing    | anchored `old_string`/`new_string`, exact match, uniqueness-checked             | section-targeted                             | content-agnostic; needs no heading contract; yields a precise typed rejection — OQ-P7-1                                                              |
| Patch verb          | `update` gains a `patch` parameter                                              | a new `patch` action                         | one write verb inherits versioning/validation/reference-checking; additive to the union, non-breaking                                                |
| Dry-run             | `dry_run:true` returns rendered result + diff, writes nothing, saves no version | always write                                 | acceptance (b); also how an operator confirms an anchor matched before spending a version                                                            |
| D2 mech. 2          | restore the snapshot exactly; missing key is a typed error                      | `snapshot[k] ?? currentPrompt[k]`            | the fallback makes every rollback a hybrid matching neither state                                                                                    |
| D2 mech. 3          | rollback routes through the same write model as update                          | rollback's private 8-key object              | two write models is how they drift                                                                                                                   |
| Persistence posture | `saveVersion` throws; `updatePrompt` aborts                                     | log-and-swallow                              | architecture.md — persistence throws, caller decides; a silent gap is unrecoverable on a durable table                                               |
| D4 signal           | warn, naming the allowlist file and exact lines                                 | refuse                                       | 103 of 131 on-disk prompts are in untracked categories — OQ-P7-4                                                                                     |
| D4 source           | parse `resources/prompts/.gitignore`                                            | a second allowlist in config                 | a config copy duplicates the SSOT and drifts                                                                                                         |
| D3                  | resource edit via `resource_manager`, sequenced after D4                        | fix now                                      | target file is itself gitignored                                                                                                                     |

### Interfaces

```ts
// NEW — src/mcp/tools/resource-manager/prompt/operations/template-patch.ts (pure)
type PatchTarget = "user_message_template" | "system_message" | "description";
interface TemplatePatchOperation {
  target: PatchTarget;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}
type PatchRejectionReason =
  "anchor_not_found" | "anchor_ambiguous" | "anchor_overlap" | "target_absent";
interface PatchRejection {
  reason: PatchRejectionReason;
  target: PatchTarget;
  anchor: string;
  occurrences: number;
}
type TemplatePatchResult =
  | { ok: true; values: Partial<Record<PatchTarget, string>>; applied: number }
  | { ok: false; rejections: PatchRejection[] };
function applyTemplatePatches(
  current: Record<PatchTarget, string | undefined>,
  ops: readonly TemplatePatchOperation[],
): TemplatePatchResult;

// CHANGED — src/mcp/tools/schemas/resource-manager.schema.ts
arguments: z.array(
  z.object({
    name: z.string(),
    type: z.enum(["string", "number", "boolean", "object", "array"]).optional(), // was z.string(), required
    description: z.string().optional(), // was required
    required: z.boolean().optional(), // NEW — closes P7-D1
    defaultValue: z.unknown().optional(), // NEW — loader parity
  }),
).optional();
patch: z.array(TemplatePatchOperationSchema).optional(); // NEW
dry_run: z.boolean().optional(); // NEW

// CHANGED — version-history-service.ts: saveVersion throws on persistence failure
// CHANGED — prompt-versioning-processor.ts: exact snapshot restore, no currentPrompt fallback
```

### Read before implementing

`schemas/resource-manager.schema.ts:69-93` · `tooling/contracts/resource-manager.json:87-92` · `resource-manager/core/types.ts:120-125` · `prompt-schema.ts:51-62`, `:427-490`, `:540` · `prompt-lifecycle-processor.ts:206-340` (capture :211, merge :247, refs :282, version :315, write :337) · `validation.ts:18-32` · `file-operations.ts:283-313` · `prompt-versioning-processor.ts:59-135` (fallback :114) · `version-history-service.ts:114-190`, `:299-340` · `jsonUtils.ts:165`, `:311` · `tests/unit/versioning/version-history-service.test.ts:98-235` · `tests/integration/versioning/version-history-workflow.test.ts` · `server/resources/prompts/.gitignore` (FOREIGN-DIRTY, read-only)

## Verify-Paths (step 3) — drift the table already incorporates

All 15 design paths exist; **zero major drift; no shims**. Line counts: schema 146 · contract 469 · core/types 230 · prompt-schema 755 · lifecycle-processor 478 · validation 449 · file-operations 483 · versioning-processor 195 · version-history-service 424 · jsonUtils 424 · .gitignore 22 · implementation_plan/prompt.yaml 78 · unit versioning test 431 · integration versioning test 556 · mcp-tools.md 1289.

1. **TREE-STATE CORRECTION.** The charter states `resource-manager/core/types.ts` and `prompt/operations/file-operations.ts` carry other sessions' uncommitted work. **Measured: BOTH ARE CLEAN** — the concurrent session landed in `c07a80c1` / `3073dfd4` / `f1bb548e` / `5ce70a71`. The ONLY foreign-dirty plan target is `server/resources/prompts/.gitignore`. Additive-edit warnings apply to that row alone; the two source files may be edited normally.
2. The foreign `.gitignore` diff (adding `documentation/` and `development/` allow-entries) is itself D4 remediation by hand. Tier 4 edits the DETECTION path in code, never the allowlist file.
3. **NEW STRUCTURAL FACT**: `PromptArgumentSchema` is consumed at TWO sites, `prompt-schema.ts:361` and `:459`. The D1 alignment target is the shared schema at `:51` — correct as designed, but parity must be verified against a schema used twice.
4. Minor line corrections carried into the table: `PromptYamlSchema` 427 (not 428) · `handleRollback` 59 (not 60) · `newVersion` 137 (not 135).
5. **Standing probe hazard**: the shell's `grep` resolves to ripgrep, which honors `.gitignore`, so any probe over `resources/prompts/` silently omits 103 of 131 prompts unless `--no-ignore` is passed. Measured: `rg -l "required: true"` → 0; `rg -l --no-ignore "required: true"` → 45. **Every worker brief must carry this.**

## Plan Table

### Tier 1 — Argument + write-path contract repair (closes P7-D1 and P7-F2)

| #   | St  | File                                                                          | Change                                                                                                                                                                                     | ~Lines | Depends | Verify                                                                         | Justification                                                  |
| --- | --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 1.1 | ✓   | `src/mcp/tools/schemas/resource-manager.schema.ts:69-77`                      | `arguments` item gains `required`, `defaultValue`; `type` narrows to the loader's 5-value enum; `type`/`description` become optional — mirror `PromptArgumentSchema` (prompt-schema.ts:51) | ~10    | OQ-P7-2 | unit: schema round-trip preserves `required:true`; rejects an invalid `type`   | the strip is here and only here                                |
| 1.2 | ✓   | `tooling/contracts/resource-manager.json:87-92` + `_generated/`               | reconcile the declared type string with the shipped shape; `npm run generate:contracts`                                                                                                    | gen    | 1.1     | `npm run validate:contracts`                                                   | the contract already declares `required?` — this makes it true |
| 1.3 | ✓   | `src/mcp/tools/resource-manager/core/types.ts:120-125`                        | align `ResourceManagerInput.arguments` with 1.1 (add `defaultValue`, narrow `type`)                                                                                                        | ~6     | 1.1     | `npm run typecheck`                                                            | keep the layer that already agreed agreeing                    |
| 1.4 | ✓   | `prompt/operations/file-operations.ts:283-313`                                | extend the written key set to cover `injection`, `registerWithMcp`, `mcpPromptMode`, `subagentModel`, `agentType`; preserve-if-present, never write defaults                               | ~35    | OQ-P7-5 | integration: update a prompt carrying each field; re-read YAML; field survives | 10-of-17 coverage is the general form of D1                    |
| 1.5 | ✓   | `prompt/utils/validation.ts:18-32` (`UPDATE_FIELDS`)                          | add merge entries for any 1.4 field that must be settable through `update`                                                                                                                 | ~8     | 1.4     | unit: merge map covers every settable YAML field                               | the merge map is the SSOT for what `update` can set            |
| 1.6 | ✓   | `tests/unit/mcp-tools/resource-manager/` (extend; new file only if none fits) | discriminating tests: `required:true` survives create AND update; each of the 5 fields survives update                                                                                     | ~120   | 1.1-1.5 | tests fail on `git stash` of 1.1/1.4, pass after                               | reproduction-first per the bug_fix route                       |

**Tier 1 gate**: PASSED 2026-08-12 (worker + main-thread re-run): 120/120 on the tier suites (183 suites / 2274 unit tests beyond the gate — the schema is MCP-registered so blast radius is wider), typecheck clean, validate:contracts green, both ratchets green.

**Tier 1 execution record (2026-08-12)**: opus worker, DEV-T1-1..4. Authored 4-field change measured as 6 (DEV-T1-2: `validation` was stripped by the same bare z.object and is the switch that ARMS required-enforcement). Preservation reads on-disk `prompt.yaml`, not the resolved `ConvertedPrompt` — carrying resolved values would bake inherited defaults into files that never declared them (DEV-T1-3). Row 1.5 = deliberate no-op: none of the 5 fields has a tool parameter, so an UPDATE_FIELDS entry would be inert (DEV-T1-4); verify discharged by the partition-invariant test. Single-writer proven, so Tier 2.2's rollback inherits preservation for free. Falsification: schema-revert → 6 schema tests fail; write-path revert → 5 disjoint per-field failures; md5-identical restores. Two findings promoted: P7-F6 (required not self-enforcing at engine layer — `hasValidationRules` gates the validator, `REQUIRED_ARGUMENT_MISSING` channel has zero readers), P7-F7 (the 5 fields survive updates but cannot be SET via the tool — public-API decision, OQ-P7-8). Byte-stability caveat for Tier 3: `required: false` is materialized on every update (converter default), so patched-vs-full-update byte-equality must normalize for it.

### Tier 2 — Version-write correctness (closes P7-D2)

| #   | St  | File                                                                                                                             | Change                                                                                                                                | ~Lines | Depends  | Verify                                                                                       | Justification                                                                                    |
| --- | --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 2.1 | ✓   | `prompt/services/prompt-versioning-processor.ts:112-121`                                                                         | remove the `?? currentPrompt.k` fallback; restore the snapshot exactly; missing key returns a typed error naming the key              | ~25    | none     | integration: rollback to a snapshot lacking a key errors instead of keeping the live value   | mechanism 2; no data implications                                                                |
| 2.2 | ✓   | `prompt/services/prompt-versioning-processor.ts:59-135`                                                                          | route rollback through the same write model Tier 1.4 established                                                                      | ~30    | 2.1, 1.4 | integration: rollback preserves the 5 fields from 1.4                                        | mechanism 3 — two write models is how they drift                                                 |
| 2.3 | ✓   | `version-history-service.ts:114-190` + `prompt-lifecycle-processor.ts:305-335`                                                   | `saveVersion` throws on persistence failure; `updatePrompt` no longer proceeds past a failed snapshot                                 | ~30    | OQ-P7-6  | unit: injected DB failure aborts the update and surfaces an error                            | architecture.md — persistence throws; today a failed snapshot is a silent gap on a durable table |
| 2.4 | ✓   | `version-history-service.ts:114-190` (+`:299-340`) and/or the history display                                                    | numbering remediation per the OQ-P7-3 ruling; existing durable rows handled per that ruling and NOT by engine-resident migration code | ~40    | OQ-P7-3  | integration: the version the operator reads as "latest" restores the content `inspect` shows | mechanism 1 — the only mechanism touching durable data                                           |
| 2.5 | ✓   | `tests/unit/versioning/version-history-service.test.ts:98-235` + `tests/integration/versioning/version-history-workflow.test.ts` | update existing numbering expectations deliberately; add a discriminating test reproducing the live incident                          | ~140   | 2.1-2.4  | tests fail against pre-fix code                                                              | existing tests encode current semantics — changing them silently would hide the regression       |
| 2.6 | ✓   | `src/infra/config/index.ts getVersioningConfig()`                                                                                | resolve the camelCase/snake_case mismatch against `config.json:84-88`                                                                 | ~10    | none     | unit: `"autoVersion": false` actually disables auto-versioning                               | P7-F1 — the config block is inert; defaults coincide, which is why it survived                   |

**Tier 2 gate**: PASSED 2026-08-12 (worker rows 2.1/2.2/2.3/2.6 + main-thread row 2.4): 164/164 on `resource-manager|versioning`, typecheck clean, both ratchets green, both SQLite gates OK; worker's full sweeps 2281 unit + 542 integration. Row 2.6 measured as ALREADY CLOSED by `b4171ca8` (2026-08-05 INERT_SPELLINGS fold) — zero source lines; its two new tests are proven non-vacuous by falsification F5. Row 2.4 record: notes §Row 2.4. Numbering semantics: go-forward with self-healing bridge rows; refused rollbacks consume nothing.

### Tier 3 — Patch-mode update (Added)

| #   | St  | File                                                      | Change                                                                                                                                                              | ~Lines | Depends  | Verify                                                                                 | Justification                                                                   |
| --- | --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 3.1 | ✓   | `prompt/operations/template-patch.ts` **NEW**             | pure `applyTemplatePatches`; exact-match anchors, uniqueness check, typed rejections                                                                                | ~150   | OQ-P7-1  | unit suite, exhaustive edges                                                           | see New-file justifications                                                     |
| 3.2 | ✓   | `src/mcp/tools/schemas/resource-manager.schema.ts`        | add `patch` and `dry_run` to the input schema                                                                                                                       | ~20    | 3.1, 1.1 | `validate:contracts`; schema rejects malformed operations                              | additive union members — non-breaking                                           |
| 3.3 | ✓   | `tooling/contracts/resource-manager.json` + `_generated/` | document `patch`/`dry_run`; `generate:contracts`                                                                                                                    | gen    | 3.2      | `npm run validate:contracts`                                                           | contracts are the description SSOT                                              |
| 3.4 | ✓   | `prompt-lifecycle-processor.ts:206-340`                   | apply patches AFTER the `UPDATE_FIELDS` merge (`:247`) and BEFORE reference validation (`:282`); `dry_run` returns rendered result + diff and returns before `:315` | ~60    | 3.1-3.3  | integration: patch produces the same file and the same version row a full update would | the placement that satisfies acceptance (c); any later hook bypasses versioning |
| 3.5 | ✓   | `prompt-lifecycle-processor.ts` (validation hop)          | reject on template-syntax error before writing, via `validatePromptYaml` (prompt-schema.ts:540) and a `processTemplate` (jsonUtils.ts:165) dry render               | ~35    | 3.4      | integration: malformed template rejected, no file change, no version consumed          | acceptance (b)                                                                  |
| 3.6 | ✓   | `tests/integration/mcp-tools/` + `tests/unit/`            | patch round-trip, ambiguity rejection, dry-run writes nothing, version-parity vs a full update                                                                      | ~200   | 3.1-3.5  | tests fail if 3.4's ordering is moved after `:315`                                     | version parity is acceptance (c)                                                |

**Tier 3 gate**: PASSED 2026-08-12 (worker + main-thread re-run): 202/202 tier suites, 2317 unit + 549 integration beyond the gate, contracts regenerated + validated, arch 451 modules, both ratchets green. Execution record: opus worker, DEV-T3-1..7 — dry-render replaced by eager-compile + DIFFERENTIAL rule after probing all 286 shipped bodies (4 would be refused by a naive render, P7-F11); `validatePromptYaml` import barred by dependency-cruiser → routed through `ResourceVerificationService` so pre/post-write verdicts share one service (DEV-T3-2, P7-F12); patch bypassing reference validation caught and armed (DEV-T3-6); description-collision exclusivity added beyond the brief (DEV-T3-5); TDZ-crash mutation replaced with a semantically equivalent discriminator (DEV-T3-7). Version parity asserted at the `recordEditResult` seam AND as byte-identical on-disk output; the durable-row assertion is Tier 6's driven run. P7-F13 (patch/dry_run silently ignored on create) → OQ-P7-9, ruled main-thread: Tier 4 rejects both explicitly on create; dry_run-on-create recorded as a v2 candidate.

### Tier 4 — Category ship-signal (closes P7-D4)

| #   | St  | File                                                                                                                                   | Change                                                                                                                | ~Lines | Depends | Verify                                                                  | Justification                                                                             |
| --- | --- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------ | ------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 4.1 | ✓   | `prompt/operations/file-operations.ts:74-94` (+ a pure helper)                                                                         | resolve whether the target category ships by parsing `resources/prompts/.gitignore`; surface the answer to the caller | ~70    | OQ-P7-4 | unit: table-driven over all 17 real categories                          | the write path never consults the allowlist; a config copy would drift                    |
| 4.2 | ✓   | `prompt/services/prompt-lifecycle-processor.ts` (create + update responses)                                                            | emit the warning (or refusal per OQ-P7-4) naming the allowlist file and the exact lines to add                        | ~35    | 4.1     | integration: create under `analysis/` warns; under `workflow/` does not | reports success identically today whether the prompt ships or not                         |
| 4.3 | ✓   | `server/resources/prompts/.gitignore` — **FOREIGN-DIRTY: additive edits only, do not reformat or reorder; coordinate before touching** | no code change; this tier edits DETECTION only                                                                        | 0      | 4.1     | `git diff` shows no P7 hunks in this file                               | another session has an uncommitted diff here — the foreign diff is D4 remediation by hand |

**Tier 4 gate**: `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:match -- "file-operations|resource-manager"`

**Tier 4 gate**: PASSED 2026-08-12 (worker + main-thread re-run): typecheck clean, both ratchets green (3199/1019 eslint, 377 tests-ts), 171/171 across 11 matched suites. Execution record: sonnet worker, DEV-T4-1..3 — pure `resolveCategoryShipStatus` (last-match-wins, anchored/unanchored per git semantics) bound to `git check-ignore` ground truth over all 17 real categories; surfacing via `OperationResult.categoryShipStatus` (only channel create/update share, DEV-T4-1); gitignore matcher hand-rolled because `ignore` is a transitive-only dep (DEV-T4-2); warning text names the allowlist file + exact `!<cat>/` and `!<cat>/**` lines, fires only when a real `.gitignore` restricts the category (DEV-T4-3). OQ-P7-9 rejections land in `createPrompt` before `validateRequiredFields`, matching the `deletePrompt` PromptError convention. Falsification: neutered parser → 20 failures; removed rejections → exactly the 2 rejection tests. Row 4.3 verified: `git diff --stat` shows only the pre-existing foreign 10-insertion diff, no P7 hunks.

### Tier 5 — Retired step labels + docs lockstep (closes P7-D3)

| #   | St  | File                                                                                                      | Change                                                                                                                                                                                                            | ~Lines | Depends         | Verify                                                                              | Justification                                                             |
| --- | --- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 5.1 | ✓   | `resources/prompts/planning/implementation_plan/prompt.yaml:70,72,74,76,78` + `.../discovery/prompt.yaml` | replace the six `(Phase N)` stepName labels with current step vocabulary, via `resource_manager` `chain_step_operation:"replace"` — never a direct file edit                                                      | ~8     | OQ-P7-7, Tier 4 | `resource_manager inspect` shows the new labels                                     | MCP-tooling-only constraint; blocked on D4 because the file is gitignored |
| 5.2 | ✓   | scope guard for 5.1                                                                                       | do NOT sweep `development/dev-workflow/*` or `analysis/notes/vault_notes/*` — their `(Phase N)` strings are the dev-loop's own legitimate phases                                                                  | 0      | 5.1             | `rg -c --no-ignore "\(Phase "` before/after shows only the 6 intended lines changed | a naive sweep corrupts unrelated vocabulary                               |
| 5.3 | ✓   | `docs/reference/mcp-tools.md` (~581-583, ~1083, ~1108-1167)                                               | document `patch`/`dry_run`, corrected `required` support, version-numbering semantics as ruled, and the ship-signal warning; correct the ":1083 saves a snapshot before changes" wording if 2.4 changes semantics | ~90    | Tiers 1-4       | every cited field name confirmed by `rg`; prettier clean                            | docs lockstep constraint                                                  |

**Tier 5 gate**: `npm run validate:format && npm run test:match -- "resource-manager"`

**Tier 5 gate**: PASSED 2026-08-12 (main-thread): `validate:format` clean, 171/171 across 11 resource-manager suites. Execution record: row 5.3 sonnet docs worker (76+/12- in `mcp-tools.md`, every claim rg-verified to file:line, one anchor drift found: ~581-583 was the Common Actions table, argument table lives ~690); rows 5.1/5.2 main-thread via spawned streamable-http server from a fresh build (`p7-t5-relabel-drive.mjs`) — the session plugin server was NOT used because its dist may predate Tier 1 and would strip `required`/`validation` from the resent argument arrays. OQ-P7-7 implemented: `!planning/` + `!planning/**` appended additively to the foreign-dirty `.gitignore` (foreign hunks untouched); `git check-ignore` and `git status` confirm planning/ ships. Measured drift: SEVEN retired-vocabulary lines, not six — the plan missed `prompt.yaml:62` (design_mode arg prose); all seven relabeled. Replacement vocabulary read from the sub-prompts' own `name:` fields — `(Step N)`, including two label corrections beyond the suffix: `Verification (Phase 2.5)` → `Verify-Paths (Step 3)`, `Implementation Plan (Phase 3)` → `Plan-Table (Step 4)`. Both updates recorded Version 2 rows (go-forward). Scope guard: zero `(Phase ` matches remain under `planning/`; dev-workflow (2+5) and vault_notes (2) untouched at baseline. Writer normalized argument field order to name/type/description/required — tool-owned serialization, `required` survived the round-trip: first client-reachable proof of the Tier 1 fix, ahead of Tier 6's formal drive.

### Tier 6 — Acceptance, live drive, closure

| #   | St  | File                                                                    | Change                                                                                                                                                                                | ~Lines | Depends   | Verify                                                                                                              | Justification                                                                                                                            |
| --- | --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 | ✓   | `tests/integration/mcp-tools/p7-acceptance.integration.test.ts` **NEW** | all three acceptance clauses in ONE driven run against a real engine; falsify by neutering the patch applier and the exact-restore fix, confirming disjoint failure sets              | ~250   | Tiers 1-5 | test passes; each mutation fails a distinct clause                                                                  | acceptance is one runnable proof                                                                                                         |
| 6.2 | ✓   | live drive (scratchpad script, spawned server)                          | `npm run build` + `verify:mcp`, then drive the REAL client flow over the wire: create → update → patch → dry-run → history → rollback round-trip, over BOTH STDIO and Streamable HTTP | —      | 6.1       | drive log shows a client-reachable patch, a clean rejection, and a rollback landing on the content `inspect` showed | surface-check is not end-to-end; P5-F5/F6 showed an integration-proven behavior a client could not reach — that is a finding, not a pass |
| 6.3 | ✓   | this plan + notes + master plan + `CHANGELOG.md`                        | tier statuses, authored-vs-measured corrections, `P7-F<n>` promotion to the master Findings Ledger, changelog entries                                                                 | ~40    | 6.2       | plan reflects measured reality                                                                                      | phase record                                                                                                                             |

**Tier 6 gate**: `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci && npm run validate:all && npm run validate:arch && npm run validate:table-contracts && npm run validate:no-phantom-columns && npm run build && npm run verify:mcp`

**Tier 6 gate**: PASSED 2026-08-13 (third run): all 36 steps green — typecheck, both ratchets, test:ci (2387 unit incl. P6 T1/T2 in-tree), validate:all, arch 451, both SQLite gates, build, verify:mcp 12/12. First-run failures (format/readme/plan-row-tracking/retire-check) and the second run's self-test break (empty grandfather list crashed its own fixture — parameterized with a synthetic entry) are recorded in notes §Tier 6 gate remediation. **P7 COMPLETE.**

## New-file justifications

- `prompt/operations/template-patch.ts` — identification gives state:none and shape:module-of-pure-functions, so it cannot live in `PromptLifecycleProcessor` (orchestration, per architecture.md) or in `file-operations.ts` (I/O boundary; applying patches there bypasses reference validation at `:282` and the version snapshot at `:315`, breaking acceptance (c)). Reuse rejected with cause: `skills-sync/service.ts:1403 parseSkillMd` is section-addressed over a different domain and heading vocabulary; importing it would couple prompt CRUD to skill export.
- `tests/integration/mcp-tools/p7-acceptance.integration.test.ts` — a new cross-cutting acceptance path spanning schema, versioning, patch and ship-signal; no existing suite covers all three clauses in one driven run.

## Execution Dispatch

| Work                                                                                         | Agent                     | Why this tier                                                                                                     |
| -------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Tier 1 (1.1-1.5)                                                                             | sonnet worker             | bounded mechanical alignment along a verified path; target shape written out in §Interfaces                       |
| Tier 1 (1.6 tests)                                                                           | sonnet worker             | bounded once the field set is frozen                                                                              |
| Tier 2 (2.1-2.3, 2.6)                                                                        | opus worker               | decision-bearing: error-posture change on a persistence boundary; regression surface is every resource update     |
| Tier 2 (2.4)                                                                                 | main thread               | touches DURABLE `version_history`; the remediation shape is an owner ruling                                       |
| Tier 3 (3.1, 3.6)                                                                            | sonnet worker             | pure module with a written interface; tests bounded once 3.4's ordering is fixed                                  |
| Tier 3 (3.2-3.5)                                                                             | opus worker               | decision-bearing: Public API union addition, rejection semantics, and the ordering that makes version parity hold |
| Tier 4                                                                                       | sonnet worker             | bounded once OQ-P7-4 is ruled; table-driven over 17 known categories                                              |
| Tier 5 (5.1-5.2)                                                                             | main thread               | resource mutation through the live tool; serialize — never parallelize tool writes                                |
| Tier 5 (5.3 docs)                                                                            | sonnet worker             | bounded once field names are frozen                                                                               |
| Tier 6 (6.1)                                                                                 | sonnet worker (authoring) | bounded test authoring; falsification review stays main-thread                                                    |
| Tier 6 (6.2-6.3)                                                                             | main thread               | never-delegate list                                                                                               |
| **Gate verdicts, tier acceptance, open-question rulings, the final live drive, scope check** | **main thread**           | **never delegated**                                                                                               |

Worker briefs carry their tier's rows plus the notes file's §Rulings VERBATIM, and must include the ripgrep `--no-ignore` hazard and the `.gitignore` foreign-dirty warning.

## Open Questions

| Id      | Status                 | Precedes          | Default (recommended)                                                                                                                                                                                              | Alternative                                                                                                                                                                                                                                                                                               |
| ------- | ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-P7-1 | RULED → notes §Rulings | Tier 3            | Anchored `old_string`/`new_string`, exact match, uniqueness-checked. Content-agnostic across all three targets; needs no heading contract; precise typed rejection                                                 | Section-targeted addressing reusing an extracted `parseSkillMd`. Rejected for v1: prompts guarantee no heading structure, and a section replace still transmits the whole section — but it is the natural v2                                                                                              |
| OQ-P7-2 | RULED → notes §Rulings | Tier 1            | Explicit fields mirroring `PromptArgumentSchema` (prompt-schema.ts:51)                                                                                                                                             | `.passthrough()`, matching the `chain_steps` precedent at schema:79. Rejected as default: passthrough admits arbitrary keys into persisted YAML — fine for opaque step objects, wrong for a typed argument contract                                                                                       |
| OQ-P7-3 | RULED → notes §Rulings | Tier 2 (2.4)      | Go-forward after-snapshot semantics (version N = the state produced by edit N, so the newest version equals what `inspect` shows); existing rows untouched; `history` display distinguishes pre- and post-fix rows | (a) display-only fix keeping before-snapshot numbering — smallest blast radius, but leaves the rollback target one edit off; (b) renumber/migrate existing rows — rejected as default: `version_history` is durable and sqlite-persistence.md prefers a real migration over engine-resident one-time code |
| OQ-P7-4 | RULED → notes §Rulings | Tier 4            | Warn, not refuse — the response names the allowlist file and the exact lines to add                                                                                                                                | Refuse for non-allowlisted categories. Rejected as default: 103 of 131 on-disk prompts live in untracked categories; refusing breaks the operator-local workflow. Third option: refuse-with-override-flag                                                                                                 |
| OQ-P7-5 | RULED → notes §Rulings | Tier 1 (1.4)      | Keep the write-path field-loss widening inside P7 — it is the general form of D1 and shares one write path                                                                                                         | Split to its own phase. Rejected as default: fixing `required` alone while `subagentModel`/`agentType` still vanish leaves delegation silently breakable, and a second phase re-touches the same file                                                                                                     |
| OQ-P7-6 | RULED → notes §Rulings | Tier 2 (2.3)      | `saveVersion` throws; a failed snapshot aborts the update                                                                                                                                                          | Keep log-and-swallow. Rejected as default per architecture.md, but flagged: it changes observable behavior for every resource update and may break existing tests                                                                                                                                         |
| OQ-P7-7 | RULED → notes §Rulings | Tier 5            | Ship the `planning/` category (allowlist it) so the label fix and the chain itself become reviewable artifacts                                                                                                     | Leave `planning/` operator-local and fix labels as a local-only edit. Decides whether Tier 5 produces a committable diff at all                                                                                                                                                                           |
| OQ-P7-8 | RULED → notes §Rulings | Tier 3 (or later) | Add 5 optional tool params (`injection`, `registerWithMcp`, `mcpPromptMode`, `subagentModel`, `agentType`) so preserved fields become settable — additive union members, non-breaking                              | Leave them file-authored only. Rejected as default candidate: MCP-tooling-only makes them unauthorable; but this is a Public API surface decision the plan did not author — OWNER ruling required (P7-F7)                                                                                                 |

## Findings (for the master plan's Findings Ledger)

- **P7-F1** — `getVersioningConfig()` reads snake_case keys while `config.json:84-88` supplies camelCase, so the entire `versioning` config block is inert. Defaults coincide with intent today, which is why it survived: no live symptom, but `"autoVersion": false` would not disable versioning.
- **P7-F2** — the write path persists 10 of the 17 fields `PromptYamlSchema` accepts; the per-argument `required` strip is one instance of a general field-loss defect. Binds any future phase relying on `injection`, `subagentModel` or `agentType` surviving a tool update.
- **P7-F3** — `version_history` numbering labels pre-edit content with a post-edit number, so no version row ever holds current live content. Binds any future phase that reads version history.
- **P7-F4** — 13 of 17 prompt categories are untracked, and the shell's `grep` resolves to ripgrep which honors `.gitignore`. Every future probe over `resources/prompts/` needs `--no-ignore` or it silently omits 103 of 131 prompts.
- **P7-F5** — the chain-management backlog memory is stale on 2 of 4 gaps: step-level CRUD (`chain_step_operation`) and chain-step schema validation (`ChainStepSchema.passthrough()`) both shipped.
- **P7-F14 (found AND fixed in Tier 6)** — row 2.4's bridge check compared the latest recorded snapshot against the RAW live `ConvertedPrompt` (`beforeContent = {...currentPrompt}`) with order-sensitive `JSON.stringify`. A converted prompt carries loader-resolved runtime keys (`registerWithMcp`, `mcpPromptMode`, `promptDir`, `scriptTools`, …) the canonical 10-key snapshot never has, so after any registry reload EVERY edit read as out-of-band and bridged — doubling `version_history` rows in steady state, violating `recordEditResult`'s documented "exactly one row per edit". Caught by the 6.1 acceptance suite's first run against a real engine (the mocked-seam Tier 3 suites structurally could not see it). Fix: `canonicalPromptSnapshot(id, source)` in `utils/validation.ts` — one projection now feeds `beforeContent`, the `promptData` base, and `handleRollback`'s `currentSnapshot`, so every before/after comparison is like-vs-like. Regression pinned by the acceptance fixture carrying loader-shaped runtime keys + scrambled key order.
- **P7-F15 (found by 6.2's live drive)** — the prompt WRITE path resolves its directory package-relative while the LOADER honors `MCP_RESOURCES_PATH`/workspace overlay: a server given a scratch resources root accepted a `create`, wrote the files into the server install tree, then lost the prompt from its own registry on the post-write refresh (`inspect` → "Prompt not found"). Same defect family as the packaged-server `MCP_WORKSPACE` state/logs defect already on record; consequence here is a split-brain write a client cannot read back. Fix belongs to that defect's own initiative, not P7 — recorded, not fixed. Until then, end-to-end drives must run against a tree where writer and loader agree (the repo root).

## Validation Strategy (step 5)

### testing_strategy

| What to test                                                                             | Test type               | Location                                                        | Why this type                                                          |
| ---------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `required`/`defaultValue` survive the tool schema                                        | unit                    | `tests/unit/mcp-tools/resource-manager`                         | boundary validation, exhaustive branches                               |
| Each of the 5 widened YAML fields survives an update                                     | integration             | `tests/integration/mcp-tools`                                   | real loader + writer round-trip; the defect lives at the file boundary |
| `applyTemplatePatches` edges (not found, ambiguous, overlap, target absent, replace_all) | unit                    | `tests/unit/mcp-tools/resource-manager`                         | pure function, exhaustive edges                                        |
| Patch produces the same file and same version row as a full update                       | integration             | `tests/integration/mcp-tools`                                   | acceptance (c) crosses processor + versioning + writer                 |
| Malformed template rejected without write or version consumption                         | integration             | `tests/integration/mcp-tools`                                   | acceptance (b); the negative must observe two absences                 |
| Rollback restores exactly, no live-value merge                                           | integration             | `tests/integration/versioning`                                  | mechanism 2 regression                                                 |
| Version numbering matches what `inspect` reports                                         | integration             | `tests/integration/versioning`                                  | mechanism 1; reproduces the live incident                              |
| `saveVersion` failure aborts the update                                                  | unit (injected failure) | `tests/unit/versioning`                                         | error-posture change; needs a fault injector, not a real DB            |
| Category ship-signal over all 17 real categories                                         | unit (table-driven)     | `tests/unit/mcp-tools/resource-manager`                         | allowlist parsing is pure; exhaustive over known input                 |
| Untouched update paths byte-identical                                                    | integration             | existing suites must pass unchanged                             | refactor safety across four tiers of write-path change                 |
| All three acceptance clauses in one driven run                                           | integration (E2E)       | `tests/integration/mcp-tools/p7-acceptance.integration.test.ts` | acceptance is one runnable proof                                       |
| Client reachability over both transports                                                 | live drive              | scratchpad script, spawned server                               | surface-check is not end-to-end (P5-F5/F6)                             |

### done_criteria

| Criterion                                        | Validation                       | Pass Condition                                                              |
| ------------------------------------------------ | -------------------------------- | --------------------------------------------------------------------------- |
| One-section edit without untouched sections      | integration + live drive         | patched file byte-equals the full-update result                             |
| Clean rejection on template-syntax error         | integration + live drive         | error returned; file mtime unchanged; version count unchanged               |
| Version parity with a full update                | integration                      | `version_history` row identical in snapshot, `diff_summary` and description |
| `required` preserved on create and update        | integration                      | re-read YAML carries `required: true`                                       |
| No field loss on update or rollback              | integration                      | all 5 widened fields survive both paths                                     |
| Rollback lands where the operator aimed          | integration + live drive         | restored content equals what `inspect` showed for that version              |
| Ship-signal correct                              | unit + integration               | non-allowlisted category flagged; allowlisted silent                        |
| Retired labels gone, unrelated vocabulary intact | `rg -c --no-ignore` before/after | exactly 6 lines changed                                                     |
| No regression                                    | full suite                       | Tier 6 gate green; existing chains and updates byte-identical               |
| Client-reachable                                 | drive log                        | patch, rejection and rollback all observed over STDIO and Streamable HTTP   |

### documentation

| Doc                                   | Update Needed                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/reference/mcp-tools.md`         | `patch`/`dry_run` parameters, corrected `required` support, version-numbering semantics as ruled, ship-signal warning; fix the ":1083 saves a snapshot before changes" wording if 2.4 changes semantics |
| `.claude/rules/mcp-contracts.md`      | if OQ-P7-2 rules for passthrough, record why the argument contract diverges from the `chain_steps` precedent                                                                                            |
| `.claude/rules/sqlite-persistence.md` | only if OQ-P7-3 rules for a durable migration — record the migration and its retirement condition                                                                                                       |
| `CHANGELOG.md`                        | Fixed + Added entries (below)                                                                                                                                                                           |

### risks

| Risk                                                    | Impact                                                        | Mitigation                                                                                             | Rollback                                         |
| ------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Numbering change invalidates existing rollback targets  | operator restores the wrong content on a durable table        | OQ-P7-3 defaults to go-forward-only with no row rewrite; display distinguishes pre/post-fix rows       | revert 2.4 alone — 2.1-2.3 are independent       |
| `saveVersion` throwing breaks existing callers          | every resource update can now fail where it previously warned | 2.3 gated behind OQ-P7-6; unit fault-injection before integration                                      | revert 2.3; posture is a single call-site change |
| Widened write set emits fields that were absent before  | YAML churn across 131 prompts                                 | preserve-if-present only, never write defaults; byte-identical assertion on prompts lacking the fields | revert 1.4; field set is additive                |
| Patch anchor ambiguity silently edits the wrong region  | prompt corruption, the defect class P7 exists to end          | uniqueness check is mandatory, not opt-in; ambiguity is a typed rejection, never a best-effort match   | `dry_run` is the operator's pre-check            |
| Tier 4 collides with the foreign `.gitignore` diff      | lost work in another session's tree                           | tier edits detection code only; 4.3 is an explicit no-change row with a `git diff` verification        | none needed — no file contention by construction |
| Contract regeneration drifts `_generated/`              | `validate:contracts` red in CI                                | regenerate in the same task as the schema edit (1.2, 3.3), never separately                            | `npm run generate:contracts` is idempotent       |
| Probes miss 103 prompts via the ripgrep ignore artifact | a tier declares a sweep complete when it is not               | `--no-ignore` mandated in every worker brief and in P7-F4                                              | re-run with `--no-ignore`                        |

### release

- **commit_convention**: `fix(mcp-tools): preserve argument and prompt fields through the resource_manager write path (P7)` for Tiers 1-2/4-5; `feat(mcp-tools): patch-mode prompt update with dry-run (P7)` for Tier 3
- **scope**: `mcp-tools` (Tier 2 versioning storage work may take `server`; Tier 5 docs take `docs`)

### changelog_entry

**Fixed** — `resource_manager` no longer discards per-argument `required` and `defaultValue` on create or update, nor the prompt-level `injection`, `registerWithMcp`, `mcpPromptMode`, `subagentModel` and `agentType` fields on update. Rollback now restores a version snapshot exactly instead of merging it with live values, uses the same write model as `update`, and version numbering matches what `inspect` reports. `create` now reports when the target category is not shipped rather than reporting success identically either way.

**Added** — `resource_manager` `update` accepts a `patch` parameter: anchored `old_string`/`new_string` replacements applied server-side with template validation, so editing one section of a prompt no longer requires transmitting the untouched sections. `dry_run:true` renders and diffs the result without writing or consuming a version.

### growth_capture

- [ ] Pattern: a validator that strips a field three other layers already declare — candidate detector, "contract declares a field the input schema cannot accept" → `/knowledge-capture`
- [ ] Pattern: a shell `grep` aliased to a gitignore-honoring tool silently truncating discovery over ignored trees — belongs in `/search`
- [ ] Memory: correct the stale chain-management backlog entry (P7-F5); update master-plan status when P7 lands
- [ ] Skill correction: none yet — deviations will say

## Chain friction observed during this planning run (routing, not P7 scope)

1. `prompt_engine` accepted an unknown argument `feature_description` and rendered the declared-`required` `feature` as empty, then executed all five steps against a blank Feature section. A `required` argument that does not block execution is the same enforcement gap as P7-D1, one layer up — the flag is stored and displayed but never checked at invocation.
2. The step-1 phase guard rejected `## Analysis — Discovery & Triage`; `splitBySectionHeaders` matches headers literally, so any suffix silently fails the section. Worth stating in the step prompts, which currently say only "emit these headers".
3. Four README-charter gates (Product Positioning Fidelity, Information Placement, Semantic Discoverability, Prose Hygiene) fired on every step of an internal planning chain. They are scoped to public documentation and had to be passed as not-applicable five times.
