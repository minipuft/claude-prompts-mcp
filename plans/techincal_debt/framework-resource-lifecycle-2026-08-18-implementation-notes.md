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

### C-6 — the Tier 4 gate's universe is three files, and the asymmetry is the point

`find src -name '*lifecycle-processor.ts'` returns exactly three:

| Processor                                                        | How it registers what it wrote                              | Correct?                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `resource-manager/prompt/services/prompt-lifecycle-processor.ts` | `onRefresh()` only (`:810`)                                 | **Yes** — `fullServerRefresh` reloads prompt data, so for prompts `onRefresh` IS the registration |
| `gate-manager/services/gate-lifecycle-processor.ts`              | `gateManager.reload(id)` explicitly (`:55`, `:159`)         | Yes, since `b7102dd9`                                                                             |
| `framework-manager/services/framework-lifecycle-processor.ts`    | create registers; update/reload rely on a no-op `onRefresh` | **No** — G2                                                                                       |

`02-execution-lifecycle-stage.ts` and `runtime/telemetry-lifecycle.ts` also match a naive
`*lifecycle*` glob and are NOT resource lifecycle processors. The gate's glob must exclude them
while its set-equality still fails loudly on a fourth resource processor.

**The asymmetry is the whole design problem.** `await onRefresh()` is sufficient for prompts and
insufficient for gates and frameworks, so the gate cannot simply require an explicit `reload(id)`
call everywhere — that reds correct code, and the fix for a false positive is an exception, which
is the drift mode R-3 names as the one that outlives its reason. The rule has to be per-processor
and declared, with the prompt entry carrying WHY `onRefresh` counts there.

## Tier 1 measurements (2026-08-18)

Subagent `a32e...` was dispatched for Tier 1 and terminated on a session limit after writing the
RED test but before reporting. Its test was recovered from the worktree and its findings
re-measured directly by the main thread. Everything below is **measurement**, not reading, except
where labelled.

### M-1 — the verbatim discarded validation object

Draft payload: `system_prompt_guidance` non-empty, `phases` with 2 entries, `framework_gates` with
one entry `{ id: 'analysis-complete', description: '...' }` — no `name`.

```
DRAFT VALIDATOR   : { valid: true, score: 80, errors: [] }
WRITER RESULT     : { success: false,
                      error: "Framework write failed and was rolled back:
                              Mutation produced invalid resource state; restored previous files." }
DISCARDED OBJECT  : { valid: false,
                      errors: [ { code: "schema_validation_error",
                                  path: "frameworkGates.0.name",
                                  message: "Invalid input: expected string, received undefined" } ],
                      warnings: [] }
```

One error, fully specific, naming field and expectation — and the operator receives none of it.
G3 is not "the message could be better"; the exact sentence needed is computed and dropped.

### M-2 — the built-in sweep is the decisive R-2 evidence

`validateFrameworkSchema` run over every shipped framework:

| Framework                                                         | Verdict        | `frameworkGates[0]` keys                                                                          |
| ----------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| 5w1h, cageerf, focus, liquescent, radiant, react, scamper, verify | **PASS (8/8)** | `id, name, description, frameworkArea, priority, validationCriteria` — identical across all eight |

The verifier is not stricter than the format the system uses; it states the format the system
already universally satisfies. It is not the deviation.

### M-3 — the verifier cannot be relaxed anyway

`RuntimeFrameworkLoader` sets `validateOnLoad = config.validateOnLoad ?? true` (`:107`) and calls
the same `validateFrameworkSchema` at `:286-287` via `validateDefinition` (`:535`). So relaxing
the `ResourceMutationTransaction` verifier does not make create succeed — it moves the rejection
one step later, to `createFrameworkAtomic` step 3 (`loadAndRegisterById`), which rolls the files
back for a different stated reason. Any fix that targets the verifier produces a second, worse
failure mode. (Read + call-graph, confirmed against the `?? true` default.)

### M-4 — the required field has no advertised shape

`framework_gates` is **not a declared parameter**. `resourceManagerInputSchema` reaches it only
through the top-level `.passthrough()` (`resource-manager.schema.ts:276`), and
`tooling/contracts/resource-manager.json` mentions it twice, both times inside another parameter's
prose description ("Advanced fields (framework_gates, ...) are also accepted"). No element shape is
published anywhere on the tool surface.

The only statement of the required shape is the example JSON in
`FrameworkDraftValidator.createErrorResponse` — which is emitted **only when `framework_gates` is
absent entirely**, never when it is present but under-specified. A caller who supplies the field
gets no guidance and no error until the write rolls back.

**Recorded as a finding, not fixed this pass**: the draft-validator fix makes the failure
actionable at draft time, which is sufficient. Declaring a typed `framework_gates` parameter is
narrowing (not breaking, per CLAUDE.md's union rule) but is contract work outside this plan's
stated scope.

### M-5 — the RED test, and what turns it green

`server/tests/integration/mcp-tools/gate-framework-versioning.integration.test.ts`, describe
`framework create — pre-write and post-write validation must agree (G1)`. Two tests, both RED
against HEAD:

```
● does not accept a draft pre-write and reject the file built from it post-write
    expect(writeResult.success).toBe(draftVerdict.valid)
    Expected: true   Received: false

● reports the same verdict from handleCreate as the draft validator gave
    expect(response.isError).toBe(!draftVerdict.valid)
    Expected: false  Received: true
```

Both assert **agreement between the two layers**, not which layer wins — deliberately written
before R-2 was ruled, so the ruling could not be smuggled into the test. Turning them green
requires the draft validator to reject the under-specified `framework_gates` entry.

The registry double in that describe mirrors `RuntimeFrameworkLoader`'s load gate exactly
(re-parses the written YAML and runs `validateFrameworkSchema`) rather than registering
unconditionally. That is the anti-over-capable-double discipline applied correctly: a permissive
double would have hidden M-3 entirely.

## Deviations

| id       | Tier | What changed and why                                                                                                                                                                                                                                 |
| -------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T1-1 | 1    | Tier 1 subagent terminated on a session API limit mid-task, after writing the RED test but before producing its report. Test recovered from the worktree; all findings re-measured by the main thread rather than trusted from a partial transcript. |
| DEV-T1-2 | 1    | Used a throwaway probe test (`__g1probe.test.ts`) to capture the validation object the transaction discards and to sweep the built-ins. Removed after measurement — the durable version of the same evidence is M-1/M-2 here plus the RED test.      |
