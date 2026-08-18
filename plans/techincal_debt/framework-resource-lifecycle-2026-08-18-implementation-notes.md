---
title: "Framework resource lifecycle — implementation notes"
date: 2026-08-18
status: active
plan: framework-resource-lifecycle-2026-08-18.md
---

# Implementation Notes

## Pre-dispatch reading (main thread, 2026-08-18)

Static read of the framework path before dispatching the Tier 1 subagent. Recorded here because
it **corrects the plan's own defect table** — dispatching against the plan as written would have
sent the subagent to fix a defect that does not exist and miss two that do.

### C-1 — G2 is misfiled: `create` DOES register

`FrameworkLifecycleProcessor.createFrameworkAtomic` is a four-step routine, and steps 3 and 4 are
registration:

| Step | Call                                         | Effect                                                        |
| ---- | -------------------------------------------- | ------------------------------------------------------------- |
| 1    | `fileService.writeFrameworkFiles`            | writes disk                                                   |
| 2    | `registry.getRuntimeLoader().clearCache()`   | forces a fresh load                                           |
| 3    | `registry.loadAndRegisterById(normalizedId)` | registers the guide; rolls back files on failure              |
| 4    | `frameworkManager.registerFramework(id)`     | registers the definition; rolls back guide + files on failure |

So the gate-side F17 shape — write, claim a refresh, never register — is **not** what `create`
does. `create` is the one framework handler that already registers what it wrote.

**Where the defect actually lives**: `handleUpdate` (`framework-lifecycle-processor.ts:182`) and
`handleReload` (`:290`). Both call only `await this.ctx.onRefresh?.()` and then emit text claiming
a registry reload:

- update → `` `🔄 Framework registry reloaded` ``
- reload → `` `🔄 Framework '${id}' reloaded successfully` ``

`onRefresh` for this tool is supplied at `src/mcp/tools/index.ts:597-600` and its entire body is a
comment plus `this.logger.debug('Framework manager triggered refresh')`. It is a measured no-op —
not the gate case where `onRefresh` did real but unrelated work. **`handleReload` therefore has no
implementation at all**: its whole contract is the thing that does nothing.

Note the plan cited `index.ts:597-600` — the file is `src/mcp/tools/index.ts`, not `src/index.ts`
(where those lines are CLI argument parsing).

### C-2 — mirroring `b7102dd9` needs a public reload surface

`FrameworkManager.reloadResource(id)` is `protected` (`framework-manager.ts:185`), so the literal
gate mirror (`gateManager.reload(id)`) has no public counterpart here.
`registerFramework(frameworkId)` IS public (`:517`) and performs load-and-register with the same
semantics. Whichever is used, the loader cache must be cleared first — `createFrameworkAtomic`
step 2 exists for exactly that reason, and an update that skips it re-registers stale content.

### C-3 — G1's cause is element-level, not top-level (HYPOTHESIS — subagent must measure)

The two validators check disjoint things, and neither is a superset of the other:

| Validator                                    | Runs                            | Checks                                                                                                                                                                                                    |
| -------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FrameworkDraftValidator.validate`           | pre-write, on the draft         | presence/non-emptiness of `system_prompt_guidance`, `phases`, `framework_gates` only. **Never inspects array elements.**                                                                                  |
| `validateFrameworkSchema` via `validateFile` | post-write, on `framework.yaml` | `id`/`name`/`type`/`version`(semver)/`enabled` required, **plus per-element** `FrameworkGateSchema` (`id` and `name` required on every entry) and `TemplateSuggestionSchema` (`section` and `type` enums) |

Top-level fields cannot be the cause: `handleCreate` hard-requires `name`, derives `type` from the
id when `framework` is omitted, and `buildFrameworkYamlData` always writes `enabled` and
`version: '1.0.0'`. The remaining disagreement is element shape — a `framework_gates` array whose
entries satisfy "non-empty array" but lack a per-entry `name` passes the draft validator and is
rejected by the file verifier.

**This is a reading, not a measurement.** Task 1.1 stands: capture the real `validation` object.

### C-4 — new defect, same class as gate FIX 4

`handleDelete`'s `dry_run` text promises `📜 Would purge this framework's rows from
\`version_history\``. The live path (`fs.rm`+`frameworkManager.unregister`) purges nothing. This
is the identical false claim corrected on the gate side in `b7102dd9`. Tracked as **G4**.

### C-5 — Task 3.2 confirmed present

`handleDelete:207` and `handleReload:283` both open with
`frameworkManager.getFramework(id) === undefined → error`. These are the registry-membership
guards removed on the gate side: a framework on disk but absent from the registry is undeletable
and unreloadable through the tool, which is precisely the state G2 produces.

## Deviations

| id  | Tier | What changed and why |
| --- | ---- | -------------------- |
