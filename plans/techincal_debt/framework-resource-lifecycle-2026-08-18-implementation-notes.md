---
title: "Framework resource lifecycle — implementation notes"
date: 2026-08-18
status: active
tags:
  - frameworks
  - mcp-tools
  - resources
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

## Tiers 2-3 — in flight (as of 2026-08-18, mid-session flush)

Implementer agent is mid-work. Recorded here so the edit set survives compaction; **none of this
is validated yet** and no row in the plan table has been flipped on its account.

| File touched                                                                | Tier row | What it is                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mcp/tools/framework-manager/services/framework-draft-validator.ts`         | 2.1      | Element-shape validation for `framework_gates` / `template_suggestions`; `createErrorResponse` now selects its worked example by the field named in the error, so a present-but-malformed field gets the same guidance an absent one already got |
| `modules/resources/services/resource-verification-service.ts`               | 2.1      | Receives the element validation, per DEV-T2-1 — the tool layer may not value-import schemas, this service may and already does                                                                                                                   |
| `modules/resources/services/resource-mutation-transaction.ts`               | 2.2      | G3: surface the `validation` object the reject path computes and discards                                                                                                                                                                        |
| `tests/unit/resources/resource-mutation-transaction.test.ts`                | 2.2      | NEW — unit coverage for the G3 message                                                                                                                                                                                                           |
| `mcp/tools/framework-manager/services/framework-lifecycle-processor.ts`     | 3.1-3.3  | G2 re-register on update/reload; guard removal on delete/reload; G4 dry-run text                                                                                                                                                                 |
| `tests/integration/mcp-tools/gate-framework-versioning.integration.test.ts` | 2.1, 3.x | Tier 1's two RED tests turn green here; new coverage for the Tier 3 rows                                                                                                                                                                         |
| `scripts/validate-registry-coherence.js` (NEW, 33k)                         | 4.1      | The R-3 gate, plus a `--self-test` mode                                                                                                                                                                                                          |
| `package.json`                                                              | 4.2      | `validate:registry-coherence` and `validate:registry-coherence:self-test` registered at `:114-115`                                                                                                                                               |

**DEV-T2-1 is closed** (measured 2026-08-18 19:42): element validation moved onto
`ResourceVerificationService` and the arch error cleared.

```
tsc --noEmit -p tsconfig.json   → exit 0
validate:arch                   → OK, 468 modules, 0 errors / 11 warnings
```

The 11 remaining warnings are pre-existing and none are on these files
(`engine-cross-layer-type-only` x9, `no-circular` x2 on `workflow-ir/types.ts` and
`execution-context.ts`).

**Build health of the shared tree, measured for a peer session** (they suspected these in-flight
files were breaking template rendering in a dist built from the tree):

```
npm run build      → dist/index.js, dist/cpm.js
npm run verify:mcp → OK: 18/18
                     PASS prompts/list (protocol) — 111 of 118 bound
                     PASS prompts/get (protocol) — action_plan
```

`prompts/get` is a real render through a server spawned from that dist, so the tree bundles and
renders. The hypothesis also fails on mechanism: typecheck exits 0 (no half-moved import to throw
at init) and all four files are on the resource WRITE path, where a module-init throw would take
down tool registration rather than templating — and all three tools registered. Redirected them to
the offline phase-guard session's half-landed `setStepState` hunks in stages 18/19, which are on
the execution path. Discriminator given: reproduces on a build from committed HEAD → theirs;
only on a tree build → the offline session's.

**Follow-up, 2026-08-18 — my attribution was wrong, the discriminator was right.** The peer ran
the committed-HEAD-vs-tree test and it reproduced on a **committed-HEAD detached-worktree build**,
so the phase-guard hunks I named were not the cause. Nor was it a regression: every probe
generation that day carried it. Real cause is `reference_demo`-specific — its inline `word_count`
script hard-requires `text`, and CHAIN-mode argument resolution does not apply prompt argument
defaults the way the single-prompt path does (single control renders with `text=""`, chain control
fails). Not in this plan's scope; it belongs to the consolidation plan.

Two lessons worth more than the finding:

1. **My `verify:mcp` render was a false negative for their question.** `prompts/get (protocol)`
   exercises `action_plan`, not `reference_demo`, and not the chain path at all. I reported
   "the tree bundles and renders" — true, and not an answer to "does chain-mode rendering work".
   Same shape as `feedback_surface_check_vs_end_to_end`: 18/18 green on a surface that never
   touched the failing path.
2. **The transferable output was the discriminator, not the hypothesis.** Naming the offline
   session was a guess dressed as a lead. "Reproduces on a build from committed HEAD → yours;
   only on a tree build → theirs" cost one sentence, settled it, and would have been correct
   whichever way it fell.

**Tier 4 is now in flight too** — the gate script exists and both npm entries are registered.
Registration is not evidence: `validate:all` wiring, the `--self-test`, and the two required
mutations (remove a real registration call -> must red; add an unclassified lifecycle processor ->
must red) are all unmeasured. A 33k script that has never been shown to fail is exactly the
"reads as coverage" shape R-3 warns about.

**Still open until measured**: red-on-mutation proof per assertion, `test:ci`, `lint:ratchet` with
a per-rule diff against a freshly measured actual, `typecheck:tests:ratchet`, Tier 4's two gate
mutations, and the main-thread live drive.

## Deviations

| id       | Tier | What changed and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T1-1 | 1    | Tier 1 subagent terminated on a session API limit mid-task, after writing the RED test but before producing its report. Test recovered from the worktree; all findings re-measured by the main thread rather than trusted from a partial transcript.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| DEV-T1-2 | 1    | Used a throwaway probe test (`__g1probe.test.ts`) to capture the validation object the transaction discards and to sweep the built-ins. Removed after measurement — the durable version of the same evidence is M-1/M-2 here plus the RED test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| DEV-T2-1 | 2    | **My brief was wrong.** I instructed the implementer to import `FrameworkGateSchema`/`TemplateSuggestionSchema` directly from `#engine/frameworks/definitions/framework-schema.js`, without checking `.dependency-cruiser.cjs` first. `tool-layer-no-validator-value-imports` (`:213-222`, severity `error`) forbids exactly that and names the sanctioned path in its own comment: use `ResourceVerificationService` from `modules/resources/services`. Type-only does not help — the check needs `.safeParse()` at runtime. Redirected: element validation moves onto the service, the draft validator calls it. Better design regardless, since the service already owns resource-document validation and already imports every schema, so the one-copy-of-the-shape argument survives intact. The R-2 ruling is unaffected — this changed the mechanism, not the diagnosis. |
| DEV-T2-2 | 2    | An uncommitted in-flight file blocked a peer session's pre-push. These gates read the **working tree**, not the push range's committed content, so one session's mid-edit file blocks pushes for every session in the shared worktree even when every commit involved is green. Third occurrence this week of the worktree-vs-committed-state distinction costing a cycle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Tier 2-4 execution (2026-08-18)

### M-6 — where the element check landed, and why not where the brief said

The dispatch brief told the subagent to import `FrameworkGateSchema` / `TemplateSuggestionSchema`
directly into `framework-draft-validator.ts`. That compiles and `npm run typecheck` is clean, but
`npm run validate:arch` rejects it: `.dependency-cruiser.cjs:213-222`,
`tool-layer-no-validator-value-imports`, severity **error** — `src/mcp/tools/**` may not
value-import a resource schema, and the rule's own comment names the replacement
(`ResourceVerificationService`). A type-only import does not help, because `.safeParse()` is
needed at runtime.

Landed instead as `ResourceVerificationService.validateFrameworkDraftElements(draft)`
(`resource-verification-service.ts`), which the draft validator calls through an injected service
and renders with the service's existing `formatIssues`. The SSOT argument survives intact and gets
stronger: the service imports the schema, the tool imports the service, one copy of the shape, and
pre-write and post-write failures are now rendered by the same function.

The container names differ across that boundary and the difference is load-bearing — the draft
carries `framework_gates` / `template_suggestions`, the document carries `frameworkGates` /
`templateSuggestions`, and the writer copies each array through verbatim. So the element shape is
identical and only the container name differs, which is why a draft-time issue names the
snake_case field the operator actually typed.

### M-7 — the R-3 gate found its own drift mode on its first run

`validate-registry-coherence.js` went **green on its first run with the entire gate router outside
its scan**. Its switch matcher required `switch (action)`; `gate-manager/core/manager.ts` spells it
`switch (args.action)`. The gate processor stayed classified via the filename enumeration, so it
was never "unclassified", and it had no resolved edges, so its registration rules were evaluated
zero times. A green run meaning nothing — the exact placebo R-3 warns about.

Two fixes, both kept: the pattern accepts an optional receiver, AND a fourth set-equality
direction was added — **a classified processor that no dispatch edge reaches is a finding**. The
pattern fix alone would have closed this instance and left the class open. `--self-test` case 3b
encodes the incident.

### M-8 — knip-ratchet, format and plan-row-tracking failures are NOT from this work

`npm run validate:all` reports 3 of 43 steps failing. Attribution, measured:

| Step                         | Cause                                                                                                                                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate:knip-ratchet`      | exports +1, types +1, unlisted +13. **Byte-identical with this tier's new script moved out of `scripts/`** — the deltas are another session's untracked test files plus a baseline they have not refreshed                                          |
| `validate:format`            | two `plans/**` implementation-notes files modified by another session                                                                                                                                                                               |
| `validate:plan-row-tracking` | a completed-marked row in the phase-guard session's plan naming their `validate-phase-header-drift` script, which is on disk but untracked. Their row, their file — and it fires only locally, since an untracked file is absent from a CI checkout |

Three `tests/integration` failures (`sqlite-backend.test.ts` ×2, `chain-run-storage.integration.test.ts`)
come from the uncommitted `SCHEMA_VERSION = 23 → 24` bump in `sqlite-engine.ts`, which belongs to
the offline phase-guard session and is on this work's do-not-touch list.

### M-9 — per-rule ESLint diff, freshly measured

The ratchet baseline is a CEILING (3200 errors / 1020 warnings) against an actual of 3169 / 1007,
so a green ratchet can absorb a new violation. Measured per rule over exactly the four changed
`src/` files, HEAD content vs working tree:

```
BEFORE  {sonarjs/cognitive-complexity: 1 warn, strict-boolean-expressions: 6 err, no-unnecessary-condition: 3 err}
AFTER   {no-unnecessary-condition: 2 err}
```

No rule increased and no new rule appeared; the new script contributes zero findings.
`validate()`'s cognitive complexity went 22 → 15-or-under by extracting `measureCoverage` /
`collectErrors` / `collectWarnings` / `computeScore` — it was already over the hard limit at HEAD
and the element check would have pushed it to 23.

## Deviations (continued)

| id       | Tier | What changed and why                                                                                                                                                                                                                                                                                                                                                                            |
| -------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T2-1 | 2    | Element validation landed on `ResourceVerificationService`, not as a direct schema import in the draft validator — `validate:arch` rule `tool-layer-no-validator-value-imports` forbids the latter at severity error. Notes M-6. SSOT reasoning unchanged and strengthened                                                                                                                      |
| DEV-T2-2 | 2    | Decomposed `FrameworkDraftValidator.validate` into four private pure helpers. Not asked for, but the element branch pushed an already-over-limit function from cognitive 22 to 23, and this repo blocks at 15. Net −8 lint findings across the changed files                                                                                                                                    |
| DEV-T2-3 | 2    | `createErrorResponse` header now reads `(N% field coverage)` rather than `(N% complete)`. The score is documented as field coverage, and "80% complete" beside a hard failure is the message-honesty class this plan exists to fix                                                                                                                                                              |
| DEV-T2-4 | 2    | `ResourceMutationTransaction` gained a defaulted constructor parameter for `ResourceVerificationService` (stateless, pure formatting). Every existing `new ResourceMutationTransaction()` call site is unchanged                                                                                                                                                                                |
| DEV-T3-1 | 3    | `handleUpdate` / `handleReload` share one private `reregister(id)` — clear the loader cache for that id, then `registerFramework(id)`. `clearCache(id)` is per-id, narrower than `createFrameworkAtomic`'s clear-all, which is left untouched                                                                                                                                                   |
| DEV-T3-2 | 3    | `handleDelete`'s success message now branches on `unregistered`, mirroring `b7102dd9`. Not in the brief, but the guard removal makes "registry updated" false for exactly the orphan case task 3.2 makes deletable                                                                                                                                                                              |
| DEV-T4-1 | 4    | Added a FOURTH set-equality direction beyond the three R-3 named: a classified processor no dispatch edge reaches. Found by the gate failing this way on its own first run (notes M-7); the pattern fix alone would have closed the instance and left the class open                                                                                                                            |
| DEV-T4-2 | 4    | Added `--list`, which prints the resolved dispatch universe. A gate whose scan silently narrows reads as coverage; M-7 is exactly that, and it was diagnosed only by making the universe inspectable                                                                                                                                                                                            |
| DEV-T4-3 | 4    | `HANDLER_LOCAL_MUTATIONS` carries one entry — prompt `reload` is handled on the router itself. Declared with `closedBy` and audited by `lib/exception-hygiene.js` rather than silently skipped, so a 4th resource type cannot be added entirely inside a router                                                                                                                                 |
| DEV-T4-4 | 4    | Implementer left plan rows 2.1-4.2 unflipped, correctly: `validate:plan-row-tracking` reds a ✓ naming an untracked file, and `scripts/validate-registry-coherence.js` was untracked until the main thread committed it. All seven rows flipped to ✓ in `457d3121`/`088d01d4`, the commits that track the file. **Resolved** — retained as the reason the rows arrived open, not as a live claim |

## Live drive — main thread, 2026-08-18 (never delegated)

Server spawned from a fresh `dist/` over Streamable HTTP, one process, no restart. Full lifecycle.

| Step                                               | Result                                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| create with `framework_gates: [{id, description}]` | **Rejected pre-write**: `framework_gates[0].name: Invalid input: expected string, received undefined`, with the worked example attached. **G1 + G3 closed** — the exact sentence the transaction used to discard is now the error, and it arrives before any file is written |
| create well-formed                                 | `✅ Framework created (80% - full)`, four files, no rollback. **G1 closed**                                                                                                                                                                                                  |
| inspect, same process                              | Resolves                                                                                                                                                                                                                                                                     |
| update `name`                                      | `✅ updated`, `📜 Version 4 saved`, diff rendered                                                                                                                                                                                                                            |
| inspect after update                               | `Framework: RENAMED-BY-LIVE-DRIVE`                                                                                                                                                                                                                                           |
| `system_control framework list`                    | `**RENAMED-BY-LIVE-DRIVE**` — this reads the in-memory framework map. **G2 closed, proven two independent ways**                                                                                                                                                             |
| history                                            | 2 versions listed                                                                                                                                                                                                                                                            |
| reload                                             | Succeeds                                                                                                                                                                                                                                                                     |
| delete `dry_run`                                   | `📜 Its version_history rows are NOT removed — they survive and become unreachable`. **G4 closed**                                                                                                                                                                           |
| delete                                             | Directory removed, `🔄 Framework unregistered from the registry`                                                                                                                                                                                                             |
| inspect after delete                               | `Framework not found` — round trip leaves no orphan                                                                                                                                                                                                                          |

### Two false negatives in my own probe, both mine

1. **First drive asserted on `description`, which `inspect` synthesizes.** It read
   `LIVEDRIVE_PROBE framework for systematic approach` before _and_ after the update — a generated
   default, not the stored field. The G2 verdict printed `NO` while the fix was working. Re-probed
   on `name`, which is rendered verbatim, and cross-checked against the in-memory map. **A probe
   asserting on a synthesized field cannot observe the thing under test**, and it fails in the
   direction that looks like a real defect.
2. **First drive sent `dry_run: true` without `confirm: true`** and was intercepted by the
   confirmation guard, so it never reached the G4 text at all. Reported as an `isError` that
   looked like a G4 failure.

Both were caught only because the _shape_ of the failure did not match the fix — G2's re-register
demonstrably ran, and a dry run has no business being destructive. Had either been believed, I
would have reported a working fix as broken.

### Finding, not fixed (out of scope)

`dry_run: true` requires `confirm: true` to reach the dry-run path. A dry run that demands
destructive confirmation inverts the purpose of the flag, and the text it then prints —
"Re-send with `confirm: true` and without `dry_run`" — reads as though confirm were not already
supplied. Not in this plan's scope; recorded for the settability/consolidation work.

| DEV-T5-1 | 5 | **G5 found during the live drive and fixed in scope.** Framework update was completely broken in every transport (`DatabasePort not provided`), which BLOCKED the G2 proof this plan requires. Fixing it was the only route to a done criterion already in scope, so it landed as `63ee8ed4` rather than being deferred. It also explains the plan's original mis-filing of G2: nothing could reach the registry defect because update failed first. |
| DEV-T5-2 | 5 | Live-drive probe produced two false negatives (synthesized `description` field; `dry_run` without `confirm`). Both looked like fix failures. Recorded because the lesson generalises: a probe must assert on a value the surface renders verbatim, not one it may synthesize. |

### Attribution correction (2026-08-18)

I recorded the `knip-ratchet` / `phase-header-drift` hunks in `server/package.json` and
`run-validation-suite.js` as the delegation session's. **They are the offline phase-guard
session's** — `validate-phase-header-drift.js` cites `phase-guard-declaration-contract-2026-08-15.md`
(OQ-3 / task 4.0) in its own header. The delegation session corrected me.

The handling was right regardless of whose they were, but the standing rule needs the right owner:
**neither active session stages `server/package.json` or `server/scripts/run-validation-suite.js`
whole until the phase-guard session lands its scripts.** Waiting on the delegation session would
have waited forever.

## What is and is not CI-proven (2026-08-18)

`0cad5169` is green, but **the integration tests have never executed on CI against the G-wave
commits.** The green run took the classifier's `docs` route (plan files only, 57s), and in the
`088d01d4` run the Test matrix was SKIPPED by the Build cascade rather than failed. The last real
matrix execution was `860aeca9` — pre-fix. Flagged by the delegation session; correct, and worth
recording rather than letting a green badge stand in for a run that never happened.

This is the same species the whole day catalogued: a green signal that observed something other
than the thing in question. Sixth variant — not a probe that missed the path, but a **route
selection** that legitimately excluded it.

Closed locally instead of waiting, since no code push was pending from this session:

```
npx jest tests/integration --runInBand
  Test Suites: 50 passed, 2 failed, 52 total
  Tests:       695 passed, 3 failed, 698 total
```

All three failures are one assertion — `Expected: 23, Received: 24` — in
`sqlite-backend.test.ts` (×2) and `chain-run-storage.integration.test.ts`, caused by the offline
phase-guard session's **uncommitted** `SCHEMA_VERSION 23 → 24` in `sqlite-engine.ts`, which is on
this plan's do-not-touch list. A CI checkout carries the committed `23`, so those three pass there.

`gate-framework-versioning.integration.test.ts` — the file carrying G1 and the G2 coherence
harness — is in the passing set at **27/27**.

**Precise claim**: on a clean checkout of `0cad5169` the full integration suite would pass. That is
an inference from a measured local run plus a single identified difference, not a CI observation.
It flips to observed on the next code-scope push from any session.
