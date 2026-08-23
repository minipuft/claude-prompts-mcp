---
title: "resource_manager settability parity — audit matrix"
date: 2026-08-13
status: active
tags: []
---

> **Row-status re-measurement 2026-08-19.** Two §8 gaps were closed incidentally by other
> sessions and are marked `✓` below with their commits. Every remaining row is stamped with an
> as-of date and the observation that flips it. The prose in §1–§7 still describes the
> 2026-08-13 tree and has NOT been rewritten — read §8 for current status.

# resource_manager Settability Matrix — Prompt Resource Surface

Repo: `claude-prompts-mcp`, branch `main`, read-only audit (no source edits).
State at audit time: `git diff --stat` shows heavy **uncommitted, in-tree** work on the prompt
write path (`file-operations.ts`, `prompt-lifecycle-processor.ts`, gate/framework services,
`cli-shared/version-history.ts`) — this is Fix A/B of an in-progress
`tier-b-settability-proposal` (referenced repeatedly in code comments as "P7 row 1.5/1.6",
"OQ-P7-8", "owner ruling 2026-08-13/2026-08-16"). **All findings below reflect the tree AS
CHECKED OUT, uncommitted changes included, and are marked `[in-tree, uncommitted]`** wherever the
capability exists only because of the diff in `git status --porcelain`. No plan file for this
proposal exists in `plans/` (only its own implementation-notes stub); the matrix below is written
directly against source.

Field inventory sources: `server/src/modules/prompts/prompt-schema.ts` (`PromptYamlSchema`,
`ChainStepSchema`, `PromptArgumentSchema`, `PromptGateConfigurationSchema`,
`PromptInjectionConfigSchema`, `CategorySchema`), `server/src/mcp/tools/schemas/resource-manager.schema.ts`,
`server/src/mcp/tools/resource-manager/prompt/{operations,services,utils}/*.ts`, and
`rg --no-ignore` field-usage counts across `server/resources/prompts/**/prompt.yaml`.

---

## 1. Prompt top-level fields (`PromptYamlSchema`)

Legend: ✓ = fully reachable · ⚠ = reachable with a caveat (see note) · ✗ = unreachable/broken ·
n/a = no verb of this kind applies by design.

| Field                                  | Create                     | Update (full)                                       | Patch                     | Typed op                                                | Unset/Clear                                                    | Evidence                                                                   | Verdict                                                               |
| -------------------------------------- | -------------------------- | --------------------------------------------------- | ------------------------- | ------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `id`                                   | ✓                          | n/a (lookup key)                                    | n/a                       | n/a                                                     | n/a                                                            | `prompt-lifecycle-processor.ts:100,294`                                    | Correct — not a settability gap                                       |
| `name`                                 | ✓                          | ✓                                                   | n/a                       | n/a                                                     | n/a (schema `min(1)`)                                          | `UPDATE_FIELDS` `validation.ts:22`                                         | Fully settable                                                        |
| `category`                             | ✓                          | ✓ incl. directory **move** `[in-tree, uncommitted]` | n/a                       | n/a                                                     | n/a                                                            | `file-operations.ts:259–288,635–649` (Part 2, "owner ruling 2026-08-16")   | Fully settable                                                        |
| `description`                          | ✓                          | ✓                                                   | ✓ (`PATCH_TARGET_FIELDS`) | n/a                                                     | n/a (schema `min(1)`)                                          | `template-patch.ts:21-25`                                                  | Fully settable                                                        |
| `systemMessage` (+`systemMessageFile`) | ✓ (inline only)            | ✓ to **set**, **✗ to unset**                        | ✓ to edit existing text   | n/a                                                     | **BROKEN**                                                     | see Gap #2 below                                                           | Gap                                                                   |
| `userMessageTemplate` (+`*File`)       | ✓ required                 | ✓                                                   | ✓                         | n/a                                                     | n/a (schema requires one of template/chainSteps/systemMessage) | `prompt-schema.ts:501-517`                                                 | Fully settable (design-correct non-clearable)                         |
| `arguments[]`                          | ✓                          | ✓ full-array replace, incl. clear via `[]`          | ✗                         | ✗ (no per-item op)                                      | ✓ (via `[]`)                                                   | `file-operations.ts:656-659`; no `argument_updates` anywhere (`rg` 0 hits) | Reachable but **lossy round-trip** — see Gap #5                       |
| `gateConfiguration`                    | ✓                          | ✓ incl. clear via falsy/`null`                      | ✗                         | ✗                                                       | ✓                                                              | `validation.ts:34`; `file-operations.ts:661-664`                           | Fully settable                                                        |
| `injection`                            | ✓ `[in-tree, uncommitted]` | ✓ incl. clear via `{}`                              | ✗                         | ✗                                                       | ✓                                                              | `resolvePreservedPromptYamlFields` `file-operations.ts:86-105`; OQ-P7-8    | Fully settable                                                        |
| `chainSteps[]`                         | ✓                          | ✓ full-array replace                                | ✗                         | ✓ `add`/`remove`/`reorder` (`replace` is a no-op alias) | ✓ (via `[]`)                                                   | `applyChainStepOperation` `validation.ts:387-445`                          | Reachable but **lossy round-trip** for single-step edits — see Gap #5 |
| `registerWithMcp`                      | ✓ `[in-tree, uncommitted]` | ✓ to set, **✗ to unset**                            | ✗                         | n/a                                                     | **NO** (FREEZE HAZARD, self-documented)                        | `resource-manager.schema.ts:172-179`; `file-operations.ts:58-65`           | Gap                                                                   |
| `mcpPromptMode`                        | ✓ `[in-tree, uncommitted]` | ✓ to set, **✗ to unset**                            | ✗                         | n/a                                                     | **NO**                                                         | same as above                                                              | Gap                                                                   |
| `subagentModel`                        | ✓ `[in-tree, uncommitted]` | ✓ to set, **✗ to unset**                            | ✗                         | n/a                                                     | **NO**                                                         | same as above                                                              | Gap                                                                   |
| `agentType`                            | ✓ `[in-tree, uncommitted]` | ✓ to set, **✗ to unset**                            | ✗                         | n/a                                                     | **NO**                                                         | same as above                                                              | Gap                                                                   |
| `tools[]` (script tools)               | ✓ full definitions         | ⚠ **add/overwrite only**                            | ✗                         | ✗                                                       | **BROKEN** (empty `[]` preserves old list; no per-tool delete) | `file-operations.ts:679-687,739-797`                                       | Gap (severe)                                                          |

`file` (legacy JSON-format field on `PromptDataSchema`) is out of scope — the directory-based
`PromptYamlSchema` (the format every write path actually produces) has no such field.

### Category resource (`CategorySchema`)

**Entirely unreachable.** `resource_type` accepts only `'prompt' | 'gate' | 'framework'`
(`resource-manager.schema.ts:34`) — there is no `category` resource type and no
`category_configuration`-style parameter on any prompt action. `category.yaml` (which carries
`name`, `description`, `registerWithMcp`, `mcpPromptMode` defaults for every prompt in that
category) is **read-only from the tool's perspective**: `rg -n "category\.yaml" src/` finds only
reads (`loader.ts:158`) and delete-exclusion checks (`category-maintenance.ts:64`,
`file-operations.ts:490`) — zero writers. `FileOperations.updatePromptImplementation` `mkdir`s a
new category directory on first prompt write (`file-operations.ts:297-300`) but never writes
`category.yaml` into it. Only 3 `category.yaml` files exist on disk
(`creative/`, `guidance/`, and one more) — necessarily hand-authored, which is what the project's
"MCP Tooling Only" rule forbids.

---

## 2. Chain step sub-fields (`ChainStepSchema`)

All 12 fields (`promptId`, `stepName`, `id`, `inputMapping`, `outputMapping`, `retries`,
`subagentModel`, `agentType`, `framework`, `inlineGateIds`, `visibility`, `delegation`) are
reachable as part of a **whole step object** via `chain_steps` (full array) or `chain_step_data`
(single `add`). None has a per-field patch. `chain_step_operation` supports `add`/`remove`/`reorder`
only — `replace` is declared in the enum but is a deliberate no-op
(`applyChainStepOperation` case `'replace': return currentSteps;`,
`validation.ts:440-441`); the actual whole-array replace happens through the plain `chain_steps`
parameter, so `'replace'` as an operation name is vestigial and can read as "replace one step" to
an LLM when it means nothing. To edit a single field of one existing step (say, just
`stepName`), the only paths are: resend the entire `chainSteps` array, or two update calls
(`remove` at index, then `add` with a full reconstructed `stepData`) — there is no
`update`-at-index operation.

## 3. Argument sub-fields (`PromptArgumentSchema` + `ArgumentValidationSchema`)

`name`, `type`, `description`, `required`, `defaultValue`, and `validation.{pattern,minLength,
maxLength,allowedValues}` are all now settable through the `arguments` array parameter — this was
a 2026-08-12 fix (`resource-manager.schema.ts:77-108`); before it, `required`/`defaultValue`/
`validation` were silently stripped at the Zod boundary (P7-D1). No per-argument typed operation
exists (`argument_updates` — 0 occurrences anywhere in `src/`), confirming it is **designed but
not started** ("Fix D", referenced only as a naming convention in adjacent comments, not as a
committed artifact).

---

## 4. Gate resources (`resource_type: 'gate'`) — lower resolution per task scope

Loader schema (`src/engine/gates/core/gate-schema.ts`) declares `id`, `name`, `type`,
`description`, `severity` (default `'medium'`), `enforcementMode`, `gate_type` (default
`'custom'`), `guidanceFile`, `guidance`, `pass_criteria`, `activation`, `retry_config`.

`GateManagerInput` (`gate-manager/core/types.ts:24-52`) — the actual tool-reachable surface —
**only declares `id, name, type, description, guidance, pass_criteria, activation, retry_config`.**
`severity`, `enforcementMode`, and `gate_type` are **never read anywhere in
`gate-lifecycle-processor.ts` or `gate-file-writer.ts`** — every gate created or updated through
`resource_manager` silently takes the loader defaults (`severity: 'medium'`,
`gate_type: 'custom'`, no `enforcementMode`) with no way to author otherwise short of hand-editing
`gate.yaml`.

**Data-loss finding**: `handleUpdate` (`gate-lifecycle-processor.ts:53-92`) falls back to
`existingGate.name/type/description/guidance` when the caller omits them (`name || existingGate.name`,
etc.) but **`activation` and `retry_config` have no such fallback** — they are read straight off
`args` with no merge against `existingGate`. `GateFileWriter.buildGateYaml` (`gate-file-writer.ts:96-115`)
rebuilds `gate.yaml` from scratch and only writes `activation`/`retry_config` `if (data.activation)`/
`if (data.retry_config)`. **Any update call that doesn't resupply `activation`/`retry_config`
silently deletes them from the gate**, regardless of what the caller intended to change. This is
the exact class of bug prompts already fixed via `PRESERVED_PROMPT_YAML_KEYS` — gates never got
the equivalent fix.

## 5. Framework resources (`resource_type: 'framework'`)

`framework-lifecycle-processor.ts` merges correctly on update — `writeFrameworkFiles(frameworkData,
existingData)` (`:172-173`) passes the pre-existing loaded data alongside the delta, so omitted
fields survive (no data-loss class bug here, unlike gates). Settability gap is narrower and purely
about the **tool schema's declared surface**: `resourceManagerInputSchema` only types 3 of the ~15
fields `OPTIONAL_FRAMEWORK_FIELDS` (`framework-lifecycle-processor.ts:16-35`) actually assigns —
`phases`, `gates`, `tool_descriptions` are declared; `framework_gates`, `template_suggestions`,
`framework_elements`, `argument_suggestions`, `judge_prompt`, `processing_steps`,
`execution_steps`, `execution_type_enhancements`, `template_enhancements`, `execution_flow`,
`quality_indicators` ride on the schema's outer `.passthrough()` with no declared type, no
description, and no discoverability from a client reading the tool's schema. They are technically
**settable**, just invisible to anyone (human or LLM) who isn't reading `framework-lifecycle-
processor.ts` source.

## 6. Style resources

Out of scope entirely — `resource_type` has no `'style'` member. `StyleManager` is config-resolved
only; not part of this audit's settability question.

---

## 7. Authoring-workflow layer (`>>create_prompt`) — compensation inventory

`server/resources/prompts/examples/create_prompt/user-message.md` +
`tools/prompt_builder/script.py` is the guided-authoring workflow. Compensations found:

1. **Script-tool prompts: manual two-phase scaffolding is unnecessary busywork.** The workflow
   (lines 107-244) instructs the LLM to use the `Write` tool directly to hand-create
   `tool.yaml`/`schema.json`/`script.py` in Phase 1, _then_ call `>>create_prompt` with
   `tools: [tool_id]` in Phase 2 to register. But `resource_manager`'s `create` action already
   accepts full inline tool definitions (`args.tools`, validated by `validateToolDefinitions`,
   materialized by `FileOperations.createOrUpdateTools`, `file-operations.ts:739-797`) — the whole
   two-phase dance collapses to one call. The workflow doc simply doesn't use the capability that
   exists.

2. **Chain prompts: step prompts must be manually pre-created, one call at a time.** Lines 227-244
   and 351: _"Referenced prompts (`step1`, `step2`) must exist before chain execution"_ / _"Ensure
   step prompts exist (create them first if needed)."_ This is real: `scaffoldChainStepDirectories`
   (`file-operations.ts:808-854`) only auto-scaffolds **nested** steps (`promptId` starting with
   `{parentId}/`) — flat/external references (the pattern the workflow's own examples use,
   `step1_prompt`/`step2_prompt`) get zero scaffolding. There is no "create chain + all its
   step-stub prompts in one call."

3. **Broken bridge, confirmed by grep**: `prompt_builder/script.py:201-206` emits
   `user_message_template_file` / `system_message_file` into its `auto_execute.params` whenever the
   author supplies `userMessageTemplateFile`/`systemMessageFile` (file-reference mode, which the
   workflow's own YAML examples explicitly show as valid, e.g. line 380 `systemMessageFile:
system-message.md`). `rg -n "user_message_template_file|system_message_file" src/` returns
   **zero matches** — `resource_manager`'s `create` handler never reads either parameter, only
   `user_message_template`/`system_message` (inline content). Since `create` requires
   `user_message_template` (`validation.ts` `ACTION_REQUIREMENTS`), an auto-execute call built from
   file-reference input **fails validation outright** — file-referenced prompt authoring through
   the guided workflow is fully unreachable, not merely inconvenient.

4. **Chain integrity is warn-only, at write time, against the in-memory registered set — never
   re-checked after the fact.** `validateChainStepReferences` (`validation.ts:461-479`) runs on
   both `create` and `update` (including after a `chain_step_operation`) but only produces
   non-blocking warnings, and only against `getConvertedPrompts()` — prompts loaded/reloaded at
   call time. Nothing re-validates a chain's `chainSteps[].promptId` set after an unrelated event
   (e.g. a referenced prompt gets deleted later). `deletePrompt`'s dependency check
   (`prompt-lifecycle-processor.ts:741-745`, `findPromptDependencies`) runs in the OTHER direction —
   it warns the person deleting a prompt that chains reference it, but `confirm: true` proceeds
   anyway with no re-check on the chains left holding a dangling `promptId`. There is no
   `resource_manager` action that sweeps every durable chain-carrying prompt and reports dangling
   references as a standing health check — the only integrity signal is the transient warning
   surfaced on that one prompt's own create/update/inspect call. This is distinct from (and not
   covered by) the P6 workflow-IR validator, which validates a chain's steps only at **run** time
   against `ParsedCommandSnapshot`, never against the resource store at rest.

---

## 8. Ranked gap list

| #                                                                                                                                                         | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Severity                                | Instrument                                                                                                                                                                                 | Size                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| ✓ 1                                                                                                                                                       | Gate `activation`/`retry_config` silently **deleted** by any update that omits them (no fallback to `existingGate`, unlike `name`/`type`/`description`/`guidance` on the same call)                                                                                                                                                                                                                                                                                 | **Data loss**                           | Scalars→update: mirror the merge pattern already proven for prompts (`PRESERVED_PROMPT_YAML_KEYS`) in `gate-lifecycle-processor.handleUpdate`                                              | S                     |
| ☐ (as of 2026-08-22 · flips when an explicit `system_message: ''` removes the file — `suppliedKeys.has('systemMessage')` replaces the truthiness check) 2 | `system_message` cannot be **unset** — `writesSystemMessage = Boolean(promptData.systemMessage) && (...)` checks value truthiness instead of `suppliedKeys.has('systemMessage')`, so an explicit `system_message: ''` is silently dropped and `system-message.md` is never touched                                                                                                                                                                                  | Unsettable                              | Bodies→update/patch: fix the boolean condition to match every sibling field's `suppliedKeys` check; delete `system-message.md` + drop `systemMessageFile` key when cleared                 | S                     |
| ☐ (as of 2026-08-22 · flips when `tools: []` clears the on-disk id list and a per-tool delete removes `tools/{id}/`) 3                                    | `tools[]` cannot be cleared (empty array is treated as "no change," preserving the old on-disk id list) and **no per-tool delete exists** — a removed id's `tools/{id}/` directory orphans forever                                                                                                                                                                                                                                                                  | Unsettable + unreachable delete         | Collections→typed operation: `tool_operation: 'add'\|'remove'\|'replace'` mirroring `chain_step_operation`, with a companion delete in `createOrUpdateTools` for ids dropped from the list | M                     |
| ☐ (as of 2026-08-22 · flips when each preserved field has an explicit unset path back to category/global inheritance) 4                                   | Preserved fields (`register_with_mcp`, `mcp_prompt_mode`, `subagent_model`, `agent_type`) are settable but **never unsettable** — once explicit, they freeze permanently (self-documented "FREEZE HAZARD") with no path back to "inherit from category/global default"                                                                                                                                                                                              | Unsettable                              | Scalars→update: accept an explicit `null` sentinel (distinct from omission) threaded through `resolvePreservedPromptYamlFields` to mean "remove this key"                                  | S–M                   |
| ◐ 5                                                                                                                                                       | No typed per-item op for `arguments` (`argument_updates` designed, not started) or single chain-step field edits; compounded by `inspect detail:full` never surfacing `arguments[].validation`/`defaultValue` or step `inputMapping`/`outputMapping`/`retries`/`subagentModel`/`agentType`/`framework`/`inlineGateIds`/`visibility`/`delegation` — an LLM reconstructing a full-array replace from what `inspect` shows risks silently dropping fields it never saw | Workflow-compensated / latent data loss | Collections→typed operation (`argument_updates`; `chain_step_operation:'update'`) + inspect→emit the currently-hidden sub-fields                                                           | M (ops) + S (inspect) |

Also flagged, not in the top 5 by severity but cheap to fix and cited above:

- `CategorySchema` (`registerWithMcp`, `mcpPromptMode`, category `name`/`description`) has **zero
  writer in `src/`** — `category.yaml` is authored by hand today. (Unreachable / M to fix: new
  `resource_type:'category'` or a `category_configuration` prompt param.)
- `create_prompt`'s `prompt_builder` script emits dead parameter names
  (`user_message_template_file`/`system_message_file`) that make file-referenced prompt creation
  through the guided workflow hard-fail. (Workflow-compensated/broken. S to fix — either read the
  file server-side in the script, or add matching passthrough params to `resource_manager`.)
- Gate `severity`/`enforcementMode`/`gate_type` are declared in the loader schema but never read
  by `GateManagerInput`/`gate-lifecycle-processor.ts` — unreachable at create AND update. (S–M.)
- Framework's 11 "advanced" fields ride on undeclared `.passthrough()` — settable but
  undiscoverable from the tool schema. (Cosmetic/contract-completeness, not a settability gap. S.)
- `chain_step_operation:'replace'` is a documented no-op alias for the plain `chain_steps`
  parameter — reads as "replace one step" but does nothing; naming confusion only. (Cosmetic. XS.)

### Row status (re-measured 2026-08-19 against HEAD)

Marker on each row above: `✓` closed · `◐` partly closed · `☐` open. Open rows carry an as-of
date and the observation that flips them, per `cleanup-standards.md` — an unmarked `☐` is not
checkable.

- **✓ 1 — CLOSED by `dc1c5f75`** (`fix(gates): preserve gate.yaml fields the caller did not
supply on update`). `gate-lifecycle-processor.handleUpdate` now falls back to
  `existingDefinition.pass_criteria/activation/retry_config`, and `gate-file-writer.ts` grew
  `resolvePreservedGateYamlFields`, deriving its preserved set from `GATE_YAML_DECLARED_KEYS` so
  a future schema field is carried automatically. Closed incidentally — the commit's comment
  cites this audit by filename.

- **☐ 2 — OPEN.** `file-operations.ts:578` still reads
  `Boolean(promptData.systemMessage) && (isFreshDirectory || suppliedKeys.has('systemMessage'))`,
  verbatim the audited condition.
  _(as of 2026-08-19 · flips when an update sending `system_message: ''` deletes
  `system-message.md` and drops the `systemMessageFile` key)_

- **☐ 3 — OPEN.** `rg tool_operation` returns zero hits across `src/` and `tooling/`;
  `buildPromptYamlData` still falls back to `existingYaml.tools` whenever the supplied array is
  empty, so `[]` remains "no change".
  _(as of 2026-08-19 · flips when `tools: []` clears the id list AND a dropped id's
  `tools/{id}/` directory is removed)_

- **☐ 4 — OPEN.** All five preserved params are still `.optional()` with no `.nullable()` member,
  and `resolvePreservedPromptYamlFields` still branches on `supplied !== undefined`, so an
  explicit `null` would be written into the YAML rather than removing the key.
  _(as of 2026-08-19 · flips when `register_with_mcp: null` removes the key from `prompt.yaml`)_

- **◐ 5 — PARTLY CLOSED by `ce93c8ac`** (`feat(mcp-tools): add argument_updates parameter for
prompt updates`). The originally-scoped "Fix D" landed: `prompt/operations/argument-updates.ts`
  merges by name, the router passes it through unrenamed, `create` refuses it, and combining it
  with `arguments` is refused. Its merge logic rode along in `5c3198b5`, which that commit's body
  records. Two companions remain open:
  - single chain-step field edit — `chain_step_operation` is still
    `['add','remove','reorder','replace']` and `'replace'` is still the no-op at
    `validation.ts:443`.
    _(as of 2026-08-19 · flips when an `update`-at-index operation exists)_
  - `inspect` sub-field surfacing — `prompt-discovery-processor.ts` names no `defaultValue`,
    `validation`, `inputMapping`, `outputMapping` or `inlineGateIds`.
    _(as of 2026-08-19 · flips when `inspect format:'json'` returns the literal `arguments` and
    `chainSteps` arrays)_

Sequence order note: the two closures were increments **1 and 5**, skipping 2-4. §9's ordering
argument (smallest-first, proving the write-scope pattern before the typed ops) was overtaken by
events and is no longer the reason to pick the next row.

### Also-flagged and SF rows (re-measured 2026-08-19)

- ◐ Gate `severity`/`enforcementMode`/`gate_type` — the data-loss half closed with row 1
  (`gate-file-writer.ts` now preserves them from disk); still **not settable**, `GateManagerInput`
  does not declare them.
  _(as of 2026-08-19 · flips when a create/update call can author `severity`)_
- ☐ `create_prompt` file-reference bridge — `rg "user_message_template_file|system_message_file"
src/` still returns zero.
  _(as of 2026-08-19 · flips when either name resolves in `src/`)_
- ☐ Category resource type — `resource_type` is still `z.enum(['prompt','gate','framework'])`;
  `category.yaml` still has zero writer.
  _(as of 2026-08-19 · flips when a tool call writes a `category.yaml`)_
- ☐ Framework's 11 passthrough fields — still undeclared.
  _(as of 2026-08-19 · flips when they appear in `resourceManagerInputSchema`)_
- ☐ **SF-1** — `framework_gates` still undeclared; the contract mentions it only inside the
  `phases` parameter's prose. (Original falsifier stands.)
- ☐ **SF-2** — the confirm guard still sits above dispatch (`router.ts:76-80`) with no `dry_run`
  exemption, and `HANDLER_OWNED_CONFIRMATION` is still `Set(['prompt:delete'])` alone. `d57a9c55`
  reworked this guard without exempting previews. (Original falsifier stands.)
- ☐ **SF-3** — `framework-lifecycle-processor.ts` still calls `recordEditResult` at :160 and
  `writeFrameworkFiles` at :176. (Original falsifier stands.)
- ☐ **SF-4** — `builtInFrameworks = ['cageerf','react','5w1h','scamper']` literal still at :244.
  (Original falsifier stands.)

## 9. Proposed increment sequence — "settability parity" follow-up

1. **Gate preservation fix** (#1) — same shape as the already-landed prompt fix; smallest, highest
   ROI (closes an active data-loss path), no schema change needed.
2. **`system_message` unset fix** (#2) — isolated conditional fix in `file-operations.ts`, no
   schema change.
3. **Preserved-field unset sentinel** (#4) — one schema widening (`z.null()` union member on the
   five preserved params) + one resolver branch; unblocks a documented, self-flagged hazard.
4. **`tool_operation` typed op + orphan cleanup** (#3) — new enum param + companion delete path;
   same shape as `chain_step_operation`, so the pattern is proven, but touches file deletion
   (needs the same mutation-transaction rollback guarantees the rest of the writer has).
5. **`argument_updates` typed op** (#5, the originally-scoped "Fix D") — largest of the five;
   requires deciding an addressing scheme (by `name`, since arguments have no `id`) and interacting
   correctly with the existing full-array `arguments` parameter the same way `chain_step_operation`
   coexists with `chain_steps`.
6. **`inspect` structured-JSON surfacing** (#5 companion) — expose the currently-hidden
   `arguments[].validation`/`defaultValue` and step sub-fields, ideally as a `format:'json'` path
   that returns the literal `chainSteps`/`arguments` arrays rather than markdown prose, so any
   future full-array reconstruction is lossless without needing #5 at all for read-modify-write
   flows.
7. **Category resource type** — largest-scope item (new resource kind end-to-end); defer until the
   above prove out the write-scope/preservation pattern this would reuse.

---

## 10. Owner decisions — interview 2026-08-19

Five rulings. Each names what it decides and what it costs, so a later reader can tell a decision
from a default.

### D1 — "remove this field" is an explicit `unset: [keys]` parameter

Not a `null` sentinel and not per-field natural empties. Values and removal become orthogonal:
`unset: ['system_message', 'register_with_mcp']` alongside ordinary value edits.

Rows 2, 3 and 4 are **one diagnosis**, not three bugs — the tool had no way to express the verb
"remove". Fixing them separately would have produced three conventions for one verb.

Reuses the `suppliedKeys` write-scope machinery Fix B already built, and avoids the failure mode
where an MCP client serializes absent and `null` identically. Every future clearable field is then
free. Also dissolves row 3's "empty array means no change" ambiguity without a schema argument:
`tools: []` keeps meaning "set to empty", `unset: ['tools']` means remove.

### D2 — dropping a script tool deletes `tools/{id}/`, but only via an explicit removal verb

`unset: ['tools']` and `tool_operation: 'remove'` delete the directory. A narrowed `tools` array
only unbinds and leaves files alone.

The split is deliberate: explicit removal verbs are destructive, value-shaped edits are not. An
ordinary metadata update carrying a stale `tools` array must never become silently destructive —
that is the class row 1 and Fix A were both about.

Requires `confirm: true` on the destructive path and rollback coverage inside the existing
mutation transaction.

### D3 — preview becomes an action, not a flag

`dry_run` is removed; `action: 'preview'` replaces it. Preview is simply not in
`DESTRUCTIVE_ACTIONS`, so it never reaches the router's confirm guard at all.

This makes non-destructiveness **structural** rather than a condition someone can get backwards —
which is exactly how SF-2 happened. D2 forces the issue: once `unset` is destructive, a caller
needs to preview it without first confirming the thing they are trying to preview.

Supersedes SF-2's original instrument (adding pairs to `HANDLER_OWNED_CONFIRMATION`); that set
stays as-is.

### D4 — this arc rides the in-flight major and removes both dead members

`[Unreleased]` already carries three breaking entries, so 5.0.0 is accruing. This arc takes:

- `dry_run` removed → `action: 'preview'` (D3)
- `chain_step_operation: 'replace'` — the vestigial no-op at `validation.ts:443` — removed, and
  replaced by a real `'update'`-at-index operation, closing row 5b

No deprecation window and no parallel paths, per `cleanup-standards.md` §Parity Gates Are Debt.
The alternative (additive now, remove at 6.0.0) was rejected specifically because a stated
retirement condition still needs something to notice it came true — the failure this project has
already recorded.

Both are reachable-shape-union changes, which the Public API Contract prices as breaking. Two
CHANGELOG breaking entries required.

### D5 — `resources/prompts/` becomes bundled-only and fully tracked

Personal prompts move to the `MCP_WORKSPACE` overlay. `server/resources/prompts/.gitignore` (a
deny-by-default `*` + 21-line allowlist) is deleted.

This closes **P7-F4**. The overlay is not new machinery — CLAUDE.md already names `MCP_WORKSPACE`
as the SSOT for all paths, with workspace resources overlaying bundled ones; it simply was not
being used for this. Measured at decision time: 17 categories on disk, 8 in the allowlist, so
`analysis`, `creative`, `debugging`, `general`, `tools`, `pr-review`, `resume`,
`knowledge-capture`, `content_processing` and `framework-authoring` are invisible to git, as are
most of `documentation/` and `development/`.

Cost is a real migration of live personal prompts, felt daily until it settles.

### D6 — sequencing: migration is tier 1 and blocks the rest

The tracking migration lands **before** any unset/preview work.

The reason is review integrity, not tidiness: D2's deletion path removes files under
`resources/prompts/`, and reviewing that diff is meaningless while ten categories are invisible to
git. Building the destructive path first would mean writing and reviewing it against a tree that
cannot show its blast radius.

### Resulting tier order

| Tier | Work                                                                         | Closes                     |
| ---- | ---------------------------------------------------------------------------- | -------------------------- |
| T1   | Prompt-tracking migration to `MCP_WORKSPACE`; delete the resources gitignore | P7-F4, D5                  |
| T2   | `unset: [keys]` parameter + `action: 'preview'`; remove `dry_run`            | rows 2 and 4, SF-2, D1, D3 |
| T3   | `tool_operation` + directory deletion on explicit removal, behind `confirm`  | row 3, D2                  |
| T4   | `chain_step_operation: 'update'`; remove `'replace'`                         | row 5b, D4                 |

**Deferred, and still open with their falsifiers**: SF-1, SF-3, SF-4, gate
`severity`/`enforcementMode`/`gate_type` settability, `inspect format:'json'` (row 5c), the
`category` resource type, and the `create_prompt` file-reference bridge. §9's original
"defer the category type until the write-scope pattern proves out" condition HAS now come true
(Fix A/B shipped) — it is deferred on scope, not on that condition, and this note is here so the
next reader does not re-derive it.

---

## Summary

- **Total authorable fields inventoried**: ~15 prompt top-level + 12 chain-step sub-fields + 9
  argument sub-fields ≈ **36**, plus the category resource (4 fields, 0 reachable) and the gate
  surface (11 declared loader fields, 8 reachable through the tool).
- **Fully settable (no caveat)**: `name`, `category`, `description`, `gateConfiguration`,
  `injection` at the prompt level (5); all `ChainStepSchema`/`PromptArgumentSchema` sub-fields are
  reachable as part of a whole-object write (no individual gaps, only the typed-op gap above);
  gate `id`/`name`/`type`/`description`/`guidance`/`pass_criteria` (6); framework's whole surface
  (merge-correct, just under-declared).
- **Per-verb gap counts**: create/update(set)-unreachable — 4 (category's 4 fields) + 3 (gate
  `severity`/`enforcementMode`/`gate_type`) = **7**; unset/clear-broken — **7** (`system_message`,
  `register_with_mcp`, `mcp_prompt_mode`, `subagent_model`, `agent_type`, `tools` list-clear,
  `tools` per-item delete); typed-operation-missing — **2** (`argument_updates`, single-chain-step
  field edit); data-loss-on-ordinary-update — **1** (gate `activation`/`retry_config`), the most
  severe class since it fires without the caller asking for it.
- **Top 5 gaps** (full detail in §8): (1) gate `activation`/`retry_config` silent deletion —
  data loss; (2) `system_message` unset is broken; (3) `tools[]` unclearable + no per-tool delete,
  orphaned directories; (4) preserved fields (`register_with_mcp`/`mcp_prompt_mode`/
  `subagent_model`/`agent_type`) settable-never-unsettable; (5) no typed per-item op for
  `arguments`/single chain-step edits, compounded by `inspect`'s lossy projection of the same
  sub-fields.
- **`create_prompt` compensation list** (§7): (1) unnecessary two-phase manual tool scaffolding
  when inline `tools:[...]` already does it in one call; (2) manual one-at-a-time pre-creation of
  external chain-step prompts (no batch/nested scaffolding for flat references); (3) **confirmed
  broken** `user_message_template_file`/`system_message_file` bridge — file-referenced prompt
  creation through the guided workflow hard-fails validation, 0 hits for either parameter name
  anywhere in `src/`; (4) chain integrity is a transient, warn-only check at one prompt's own
  write time, with no standing sweep of durable chain resources and no re-check when a referenced
  prompt is later deleted.

## Standing hazards absorbed from the residuals plan (re-homed 2026-08-17)

- **P7-F4** — 13 of 17 prompt categories are gitignored: probes over `resources/prompts/` need
  `rg --no-ignore`, worker briefs must carry the warning, and fixes to gitignored shipped
  examples (e.g. the P6-F12 `pr_review_chain` repair) exist only in the local workspace and can
  never be committed. Real fix is a tracking-policy decision (owner's call) — this initiative is
  the natural place to make it, since settability parity is meaningless for resources git cannot
  see.
- **P7-F11** — 4 of 286 shipped templates fail a naive dry render, so any future bulk
  template-validation gate must be DIFFERENTIAL (new defects block, pre-existing ones are
  amnestied). Note the shipped `diagnosePromptWrite` design already embodies this: update mode
  amnesties pre-existing defects, create mode (`before = null`) blocks everything.

## Findings re-homed from the framework-lifecycle plan (2026-08-18)

`framework-resource-lifecycle-2026-08-18.md` retires to `reference` with every row closed. Four of
its findings are settability-surface problems rather than lifecycle defects, so they land here
instead of dying with it. None is fixed; each names what would close it.

- **SF-1 — `framework_gates` is hard-required but has no published shape.**
  `FrameworkDraftValidator` refuses a draft without it, yet it is not a declared parameter on
  `resourceManagerInputSchema` (it arrives through the top-level `.passthrough()`) and
  `tooling/contracts/resource-manager.json` mentions it only inside another parameter's prose.
  The one statement of its element shape is an example in an error response. A caller is required
  to send a field the tool surface never describes. Directly a §5 gap. Closing it means declaring
  a typed parameter — **narrowing, not breaking**, per the CLAUDE.md union rule.
  _(as of 2026-08-18 · flips when `framework_gates` appears in the contract with an element shape)_

- **SF-2 — `dry_run: true` requires `confirm: true` to reach the dry-run path.**
  `router.ts` applies the confirm gate above dispatch, and neither `framework:delete` nor
  `gate:delete` is in `HANDLER_OWNED_CONFIRMATION`. So a preview demands destructive confirmation,
  which inverts the flag's purpose. The `prompt` sibling is correct
  (`prompt-lifecycle-processor.ts`), so this is a parity gap, not a design question.
  _(as of 2026-08-18 · flips when a delete preview runs without `confirm`)_

- **SF-3 — framework `update` records the version row before the write.**
  `handleUpdate` calls `recordEditResult` and then `writeFrameworkFiles`, so a failed write leaves
  a `history` entry describing an edit that never landed. The three-phase safety property the
  versioning work established (validate → record → write) protects the file, not the ledger; the
  ledger can still gain a row for a write that did not happen. The error text is accurate — this is
  a state defect, not a message one.
  _(as of 2026-08-18 · flips when a forced write failure leaves no new version row)_

- **SF-4 — `builtInFrameworks` is a hardcoded list.**
  `framework-lifecycle-processor.ts` guards deletion against a literal
  `['cageerf', 'react', '5w1h', 'scamper']`. The project handbook's Key Constraints require
  `frameworkManager.getFramework(id)` and forbid hardcoding framework lists — and the list is
  already wrong, since `focus`, `liquescent`, `radiant` and `verify` also ship. Deleting a shipped
  framework not on the list is currently permitted.
  _(as of 2026-08-18 · flips when the guard derives its set from the registry)_

SF-1 and SF-2 surfaced in the R-5 message-honesty audit; SF-3 and SF-4 were adjacent findings that
audit reported and nothing else recorded.
