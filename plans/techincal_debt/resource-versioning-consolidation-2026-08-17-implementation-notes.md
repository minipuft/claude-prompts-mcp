---
title: "Implementation Notes — Resource Versioning Consolidation (A–F)"
date: 2026-08-17
status: done
tags: []
---

# Implementation Notes — Resource Versioning Consolidation (A–F)

Deviation log for `resource-versioning-consolidation-2026-08-17.md`. Created before the first edit.
Conservative option, log under `## Deviations`, keep going.

**Plan status**: Tiers 0-4, 6 and 7 complete. Tier 5 rejected on evidence (OQ-E1). Every open
question is ruled; two were overridden by the operator and shipped in the same PR, which makes the
release a breaking major.

## Rulings

Open questions flip from OPEN to RULED here, with the rationale, before their dependent tier runs.

| id    | Status               | Ruled      | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----- | -------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-A1 | **RULED**            | 2026-08-17 | Probe at task 1.1 run early. `rg "\.handleAction\("` shows the three resource handlers are reached from exactly one place each — `router.ts:181` (prompt), `:266` (gate), `:394` (framework) — and each handler class has exactly one construction site (`prompt-resource-handler.ts:315`, `gate-manager/core/manager.ts:93`, `framework-manager/core/manager.ts:129`). A pre-dispatch guard in the router therefore covers all three, and the six per-processor guards can be removed rather than kept as defence in depth. **Scope note**: `system_control` is a separate tool with its own destructive actions (`clear`, `maintenance`) reached via `index.ts:943` and `prompt-executor.ts:522`; `DESTRUCTIVE_ACTIONS` as planned does NOT cover it. Either extend the guard to that surface in Tier 1 or state the exclusion — do not leave it implied. |
| OQ-A2 | **RULED**            | 2026-08-17 | Raised 2026-08-17 by the OQ-A1 probe. `system_control` has three more hand-written `!args.confirm` guards (`config-action-handler.ts:41`, `analytics-action-handler.ts:44`, `maintenance-action-handler.ts:23`) and **two destructive actions with no guard at all**: `session clear` and `session cancel` (`session-action-handler.ts:21,25`). `clearSession` reports "All state and artifacts for this session have been removed" and, when the id matches no session, **silently falls through to `clearSessionsForChain(id)`** — so a stale or typo'd id escalates from one session to every session on that chain. Adding a `confirm` requirement changes behaviour for existing callers of a shipped tool, which is why this is a ruling and not a task. The silent escalation is a defect independent of the guard. See F12.                         |
| OQ-C1 | **RULED**            | 2026-08-17 | Default adopted but DERIVED, not restated: the gate projection subtracts from `GATE_YAML_PROJECTED_KEYS`, so a new schema field lands in the preserved set and leaves the projection with nothing to update by hand. Frameworks have no such partition, so the line is what `writeFrameworkFiles` can actually set. Full reasoning under "Tier 3 — Item C"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| OQ-G1 | **OVERRIDDEN**       | 2026-08-17 | Ruled defer-to-next-major on union-change cost, then overridden by the operator and implemented in this PR. Both readings kept; the release is a breaking major                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| OQ-E1 | **RULED — REJECTED** | 2026-08-17 | None of the three recorded options. Tree snapshots refuted on measurement: gates (25 dirs) and frameworks (8) have ZERO files their writers do not own, prompts have `tools/` in 7 of 121, and a recursive walk captures nested chain-step prompts that are separately versioned (F16). F7 closed by disclosure instead                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| OQ-F1 | **OVERRIDDEN**       | 2026-08-17 | Ruled defer (no measured demand), then overridden by the operator and implemented as `source_workspace` in this PR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Red-before-green evidence (Tier 0)

Task 0.5 requires each new assertion to be shown red before its fix lands. An assertion with no
entry is unverified, not passing.

Run: `NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBand tests/integration/mcp-tools/gate-framework-versioning.integration.test.ts`
Result at HEAD `dbca4508`: **2 failed, 1 passed, 3 total.**

| Assertion                         | Finding | Evidence at HEAD                                                                                                                                                                                                                |
| --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gate go-forward numbering         | F1      | ✓ RED — `expect(newest.snapshot['description']).toBe('v2 description')` → `Received: "v1 description"`. The live gate is v2; the newest recorded version holds the state the edit replaced, and the produced state is in no row |
| gate restore fidelity             | F2      | ✓ RED — `expect(response.isError).toBe(true)` → `Received: false`. Rollback against an incomplete snapshot merged the live value instead of refusing                                                                            |
| refused rollback writes no rows   | F3      | **GREEN at HEAD, and correctly so** — see DEV-T0-1. Guarded against vacuity by `expect(before).toBeGreaterThan(0)`, which passes, so the row count is real                                                                      |
| framework go-forward numbering    | F1      | ✓ RED — `expect(history!.versions[0]!.snapshot['name']).toBe('v2 name')` → `Received: "v1 name"`                                                                                                                                |
| framework restore fidelity        | F2      | ✓ RED — `expect(response.isError).toBe(true)` → `Received: false`                                                                                                                                                               |
| prompt refused-rollback row count | F3      | ✓ RED — `expect(countPromptVersionRows()).toBe(before)` → `Expected: 1, Received: 3`. The bridge row plus the restore row, written before the restore was rejected                                                              |
| router destructive-action guard   | F4      | ✓ verified by mutation — guard disabled → **7 failed, 26 passed**; guard restored → **33 passed**                                                                                                                               |

## Deviations

### DEV-T0-1 — F3 is not reachable on the gate path yet; the plan implied it was

**What the plan said**: task 0.2 places the refused-rollback row-count assertion in the new
gate/framework file and expects it to fail against HEAD.

**What is true**: `VersionHistoryService.rollback` validates target-not-found _before_ any write
(`version-history-service.ts:381`), and the `confirm` guard sits ahead of the service entirely
(`gate-versioning-processor.ts:39`). Both of those refusal paths already write nothing. The refusal
that _does_ leave a bridge row plus a restore row is the **incomplete-snapshot** one — and on the
gate path that refusal does not exist yet, because F2's merge means the gate rollback never
refuses. So F3 has exactly one reachable instance today, on the **prompt** path
(`prompt-versioning-processor.ts:202`).

**Action taken**: the row-count assertion ships as a green invariant guarding the two
already-correct refusal paths, with an explicit vacuity guard. The red-against-HEAD instance of F3
belongs in a prompt-path test, which task 0.2 must add. The gate/framework refusal case becomes
testable only after Tier 3.

**Consequence for the plan**: F3's severity is unchanged, but its blast radius is narrower than the
finding text implies — "on all three types" is true of the code path, not of what is reachable
through the tool today. Tier 2's acceptance criterion should read: the prompt-path refusal writes
no rows, AND the gate/framework refusals introduced by Tier 3 write no rows either.

### DEV-T1-1 — one of the six "duplicated" guards was not a duplicate

**What the plan said**: task 1.3 replaces all six `confirm` guards with the router registry.

**What is true**: `prompt-lifecycle-processor.ts:668` computes the set of prompts that reference
the delete target and names them in the refusal. The router has no view of the prompt dependency
graph, so guarding that pair centrally would replace a specific refusal ("3 prompts reference it
and would break: …") with a generic one — a downgrade wearing the shape of consolidation. Five of
the six were genuine duplicates; the sixth carries domain information.

**Action taken**: added `HANDLER_OWNED_CONFIRMATION` (`resource-manager/core/types.ts`) — a
one-entry bypass list containing `prompt:delete`, with the test an entry must pass written into
its doc comment ("does the handler's refusal tell the caller something the router cannot?"). The
router stands down for listed pairs. The other five guards are deleted.

**Why a bypass list is acceptable here**: it is driven from the same constant the router reads, so
the router test skips exactly the listed pairs and asserts the unlisted ones, and a separate test
asserts listed pairs still dispatch. An entry cannot go stale without a test moving with it.

### DEV-T1-2 — an existing handler test asserted the guard this tier moved

`tests/unit/mcp-tools/gate-manager/manager.test.ts` had `delete requires explicit confirmation`,
asserting `GateToolHandler` refuses unconfirmed deletes. That guard now lives in the router, so the
test failed. Rewritten to record the new contract rather than deleted: it now asserts the handler
does NOT refuse, with a comment naming the bounded behaviour change (a caller reaching the handler
outside the router deletes unconfirmed; measured 2026-08-17, no such caller exists) and pointing at
the router test that owns the coverage. The rewritten test is the marker that fires if a second
entry point is ever added.

### DEV-T1-3 — `prompt:delete` confirmation has no handler-level test (pre-existing)

`rg "Deletion requires confirmation|would break" tests/` returns nothing: the blast-radius refusal
at `prompt-lifecycle-processor.ts:668` was never covered. This gap predates this work and the code
path is unchanged by it, but the new `HANDLER_OWNED_CONFIRMATION` exemption now _depends_ on that
guard, so an untested exemption is exactly the stale-exception blind spot.

Mitigated in part: the router test asserts listed pairs dispatch, so the exemption itself is
observable. The handler-side assertion is still missing.

☐ (as of 2026-08-17 · flips when a `PromptLifecycleProcessor.handleDelete` test asserts the
unconfirmed refusal names its dependents — needs a delete harness the prompt lifecycle test file
does not currently have)

### DEV-T1-4 — OQ-A2 ruled: no `confirm` on the session actions; fix the defects instead

**Operator ruling 2026-08-17**: a confirmation gate is not the right mechanism here. Fix both
`system_control session` operations directly.

Implemented:

1. **`clear` no longer escalates silently.** It resolved the id by trying `clearSession` and, on
   failure, calling `clearSessionsForChain` — which strips the run number and walks the chain's
   whole run history. A stale, mistyped, or out-of-scope session id therefore swept every run of a
   chain, reported as success. The handler now resolves the id against `listActiveSessions` BEFORE
   deleting: session id → clear that session; chain id → sweep that chain, reporting the count;
   both → refuse as ambiguous; neither → remove nothing and say so.
2. **`clear` is scope-aware.** `ChainSessionManager.clearSession` read `activeSessions` directly
   with no scope check while `cancelChain`, one method away, enforced scope via
   `getSessionForMutation`. It now takes an optional `scope` and uses the same helper. Internal
   sweeps (`cleanupStaleSessions`, `clearSessionsForChain`) call it without a scope, preserving
   their cross-scope behaviour.
3. **`cancel` forwards the scope.** `cancelChain` accepted a `scope` parameter and enforced it; the
   handler never supplied one, so the enforcement was plumbed and unused.

Coverage: `tests/unit/mcp-tools/system-control/session-action-handler.test.ts` (6 assertions),
verified by mutation — restoring the pre-fix handler reds **all 6**; the fix greens all 6.

### DEV-T1-5 — a 236-line "scope propagation" test file was asserting the defect (F13)

`tests/unit/mcp-tools/system-control/session-action.test.ts` failed on the DEV-T1-4 change. Two
readings were possible: the fix broke working behaviour, or the tests encoded the defect. Probing
settled it — the file establishes scope with `{ organizationId: 'org-acme' }` as the MCP `extra`,
but `resolveRequestIdentity` reads auth claims, so that resolves to `default` and no scope is ever
produced. Its assertions read `toHaveBeenCalledWith('sess-1')` — pinning the _absence_ of the scope
argument under test names that promise its presence.

The clincher: the concurrency test's mock is written as
`async (_sessionId, options) => { const continuityScopeId = options?.continuityScopeId; … }` — it
branches on a scope argument the handler never passed, so the branch never fired and both
"tenants" took the same path. The scoping was anticipated, plumbed into the test, and never
implemented.

**Action**: rewrote the six affected tests to the true contract, and narrowed the concurrency test
to what it actually observes (no id crossover under concurrency) with a comment stating why the
isolation claim was withdrawn. Real scope-isolation coverage needs a fixture that establishes
identity the way the transport does; none exists.

☐ (as of 2026-08-17 · flips when a fixture establishes distinct request identities through the
auth-claims path and the concurrency test asserts isolation again)

### DEV-T1-6 — task 1.5 was a no-op; the re-registration path needed no annotations edit

The plan assumed `reregisterToolsWithUpdatedDescriptions` (`index.ts:1078`) had to re-apply
annotations or lose them on the HTTP path. Reading the SDK settles it: `_createRegisteredTool`
stores `annotations` once at registration, and `RegisteredTool.update` reassigns only the fields
present in its argument (`mcp-DXXb3Vv3.mjs:1722-1742`). The reregister path passes
`{ paramsSchema }` and touches nothing else, and it updates only `prompt_engine` in the first
place. Annotations survive. Marked ✓ by analysis rather than by edit.

**What DID need adding**: nothing proved the annotations reach a client. A config field the SDK
declines to forward typechecks identically to one it forwards, so `verify:mcp` now reads
`annotations.destructiveHint` back off `tools/list` for all three tools. Result: **17/17**, with
`prompt_engine=false`, `resource_manager=true`, `system_control=true`.

### DEV-T1-7 — `version_description` had three read sites, not two

The plan named `gate-lifecycle:118` and `framework-lifecycle:163`. `prompt-lifecycle:555` reads it
too. All three are unreachable for the same reason — `routeToPromptResource` is an explicit
allowlist exactly like the gate and framework routes, and `version_description` appears in none of
them. All three deleted along with both type declarations; `rg "version_description" src/ tooling/`
now returns nothing.

### DEV-T2-1 — task 2.3 is not an ordering fix; the CLI has a worse defect instead (F14)

The plan expected `cli-shared/version-history.ts:435` to need the same validate-before-record
reorder. It does not: the CLI rollback validates the target before writing and its caller makes no
restorability judgement, so there is no refusal-after-write path to fix.

What the read found instead is worse. `cli/src/commands/rollback.ts` writes
`serializeYaml(result.snapshot)` over the whole entry YAML, bypassing the field-preserving writers
entirely — so a CLI rollback of a gate destroys `pass_criteria`, `retry_config`, `activation` and
`guidanceFile` and injects a bogus `guidance` key. Logged as **F14 (Critical)**. It is out of
Tier 2's scope and belongs with Tier 3's snapshot contract, or is dissolved outright by Tier 5's
tree snapshots — which is the strongest argument yet for OQ-E1's default.

Task 2.3 is therefore marked ✓ as "no ordering change required", not as "CLI updated".

### DEV-T2-2 — `lint:ratchet` fails on another session's in-flight work, not on this change

`max-params` warnings went 7 → 8. The eighth is `ChainOperatorExecutor`'s constructor
(`chain-operator-executor.ts:38`), which gained a `declaredSectionsProvider` parameter in the
working tree — a file this initiative has not touched, changed by a concurrent session (its diff
also carries `19-phase-guard-verification-stage.ts` and `declared-sections.ts`). Verified against
HEAD: the constructor has 6 params there and 7 now.

**Not actioned deliberately.** Fixing it would edit another session's in-flight work, and
regenerating the baseline would absorb their regression under this initiative's commit. Every other
gate is clean and the eight violations in files this initiative touched are all present at HEAD
unchanged (`index.ts:1220` `createMcpToolRouter` has 9 params at HEAD).

✓ **CLOSED 2026-08-17** — `npm run lint:ratchet` reports `OK: 3177 errors, 1007 warnings (no
regressions)`. The concurrent session's change resolved; nothing was done here, which is what the
falsifier was for. Recording the close so the row is not re-derived.

## Tier 3 — Item C: one snapshot contract

### OQ-C1 — status: **RULED 2026-08-17** — the writer already owns the partition

**Question**: which gate and framework fields are authored versus resolved?

**Ruling for gates: adopt the recorded default, but DERIVE it rather than restate it.**
`GateFileWriter` already declares the three-way split the question asks for —
`GATE_YAML_PROJECTED_KEYS` (built from the caller's payload), `GATE_YAML_EXCLUDED_KEYS`, and
`PRESERVED_GATE_YAML_KEYS` (carried forward from disk because the writer builds no value for them,
itself derived from `GATE_YAML_DECLARED_KEYS`). `GATE_SNAPSHOT_PROJECTED_KEYS` therefore subtracts
from the writer's constant instead of maintaining a parallel list: a field added to
`GateDefinitionSchema` later lands in the preserved set automatically and is automatically absent
from the projection, with nothing to update by hand. Two content-versus-key adjustments, both
documented at the constant: `guidanceFile` dropped (hardcoded to `'guidance.md'` on every write, so
it records no restorable choice), `guidance` added (authored content living in `guidance.md`, which
is exactly why the writer excludes it from generic YAML carry-forward).

**Ruling for frameworks: same principle, different mechanism, because no such partition exists.**
The line is drawn by what `writeFrameworkFiles` can actually SET from its payload. Everything else
— `phases` and the advanced authoring fields — reaches disk through `deepMerge` over the existing
YAML, and a merge is purely additive: it cannot remove a key, so a rollback could never restore
"this field was absent at version N" for them. Projecting a field a restore cannot honour is the
defect this tier exists to remove, so they are left to the writer.

**Rejected**: the alternative (project the full YAML, let Tier 5 make it moot) for the reason
already recorded — it leaves the live defects unfixed longer.

### F15 (High) — `framework update description:"…"` was a silent no-op

Found while ruling OQ-C1. `description` is declared on `FrameworkCreationData`, listed in
`OPTIONAL_FRAMEWORK_FIELDS`, assigned onto the update payload, read back by
`toFrameworkCreationData`, and reported in the update diff — but `buildFrameworkYamlData` never
emitted it. Probe: `rg -n "description" framework-file-writer.ts` returns only `rawDescription`
(the read path) and `tool_descriptions`; `yamlData['description']` did not exist in the file. The
old value survived every update because `writeFrameworkFiles` deep-merges over the existing YAML,
so the tool reported a successful change with a diff the file never received.

It surfaced through versioning rather than through CRUD because the snapshot recorded a field no
write path could restore — the same defect one layer up. **Fixed in the writer** rather than worked
around in the contract, then projected honestly.

### DEV-T3-1 — no `Map<ResourceType, SnapshotContract>` registry

Plan task 3.1 called for a registry. Not built: no dynamic dispatch site exists. Each processor
knows its own resource type statically, so three static writers and zero readers is the shape this
plan exists to remove (`sqlite-persistence.md`: "readers: [] is a finding, not a default"). The one
generic dispatcher that would justify it — `cli/src/commands/rollback.ts`, which handles all four
types from one code path — sits behind a layer boundary that forbids importing tool-layer
contracts (`cli/tsconfig.json` maps only `@cli-shared/*`). Revisit if that boundary changes.

What the interface gained instead is `projectedFields`, which is load-bearing rather than
speculative: an update has to record the state it is ABOUT to produce, and that state exists only
as the writer's payload. Recording it in a different shape from the prior state would make
`latestSnapshotMatches` — `JSON.stringify` equality against the newest row — differ on every edit,
so every edit would bridge.

### DEV-T3-2 — task 3.5's verify grep is broader than the change it verifies

The plan's verify for 3.5 is `rg -n "\?\? existing" src/mcp/tools/` returning no hits. It returns
five after the fix, and all five are correct:

- `gate-lifecycle-processor.ts:86-88` — `pass_criteria ?? existingDefinition.pass_criteria` on the
  **update** path. `pass_criteria` is a projected key, so the writer rebuilds it from the payload;
  without this fallback a partial update would delete it. Same class as
  `resolvePreservedGateYamlFields`, which the plan already protects by name.
- `framework-file-writer.ts:349,360` — writer-level preservation of `system-prompt.md` and
  `judge-prompt.md`, the same correct-by-contrast live read.
- One prose mention in `framework-snapshot-contract.ts`.

The two the plan actually names — `gate-versioning-processor.ts:71-74` and
`framework-versioning-processor.ts:91-94` — are gone. The grep confused "restore substitutes a live
value" (the defect) with "an update preserves an omitted field" (the correct behaviour). Recorded
so the next reader does not delete the second kind.

### DEV-T3-3 — typing the boundary needed an assertion function, and immediately paid

Task 3.7 was scoped to "replace `args: any` with the typed input already declared in each
`core/types.ts`". Two facts the plan did not have:

1. `ResourceManagerInput` is NOT what a prompt processor receives — the router dispatches on
   `resource_type` and does not pass it on. Added `PromptResourceInput` (`Omit<…, 'resource_type'>`)
   and named the difference at the declaration, since that mismatch is plausibly why these
   signatures were `any` in the first place.
2. `validateRequiredFields(args, ['id'])` guarantees presence at runtime but the type system could
   not see it, so every downstream `loadHistory('prompt', id)` failed on `string | undefined`.
   Making it a generic **assertion function** (`asserts args is T & { [P in K]-?: NonNullable<T[P]> }`)
   narrowed all three handlers and every one of its ~10 sibling call sites with no other change.

The typed boundary caught eight real call sites the same turn it landed: seven test invocations
passing `{id, version, confirm}` with no `action`, which `PromptResourceInput` requires. The
`typecheck:tests:ratchet` regression (+1 and +4) was the boundary doing its job, not damage — it
returned to 375 once the call sites were corrected.

### Tier 3 result

| Gate                              | Result                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `npm run typecheck`               | clean                                                                         |
| `npm run typecheck:tests:ratchet` | OK — 375, flat                                                                |
| `npm run lint:ratchet`            | OK — 3177 errors / 1007 warnings, no regressions                              |
| `npm test`                        | 196 suites · 2587 passed · 1 skipped                                          |
| `npm run validate:arch`           | OK — 465 modules, 0 errors (11 pre-existing warnings, none in new files)      |
| Tier 0 acceptance                 | `gate-framework-versioning` **6/6 green**, was 4 failed / 2 passed            |
| F1, F2                            | closed for gates and frameworks — red before, green after, one change between |

## Tier 4 — Item D: preview any mutation

`dry_run` now covers `rollback` and `delete` on all three resource types. The plan scoped 4.2 to
gate and framework delete; **prompt delete was included too** — leaving one type without it would
reinstate the per-type divergence this whole plan exists to remove. On the prompt path the preview
sits AFTER the confirm gate, so `dry_run` can never become a way around it.

### DEV-T4-1 — `dry_run` was structurally dead on two of the three routes

`dry_run` existed in the Zod schema and in `ResourceManagerInput`, but `routeToGateManager` and
`routeToFrameworkManager` build their payloads from explicit allowlists, so it never reached those
handlers — the same mechanism that made `version_description` declaration-live and value-dead (F6).
Typechecking cannot see this: every layer compiles while the router quietly drops the field. Added
`dry_run` to `GateManagerInput`/`FrameworkManagerInput` and to both allowlists, and added a router
unit test asserting the forward, which was verified to red when the gate pass-through is removed.

### Red-on-mutation-removal, Tier 4

| Assertion                                     | Mutation removed                                                             | Result |
| --------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| `dry_run` rollback writes no row and no file  | `if (args.dry_run === true)` → `if (false)` in the gate versioning processor | RED    |
| `dry_run` delete leaves the directory         | same, gate lifecycle processor                                               | RED    |
| router forwards `dry_run` to the gate handler | the `gateArgs.dry_run` pass-through                                          | RED    |

The rollback preview test also applies the same rollback WITHOUT `dry_run` and asserts it takes
effect, so the "nothing changed" assertions cannot be satisfied by a rollback that is simply broken.

### DEV-T4-2 — `generate:contracts` picked up another session's source edit

`npm run generate:contracts` regenerated `workflow_ir.generated.ts` as well, because
`tooling/contracts/workflow-ir.json` carries an uncommitted description change from a concurrent
session (a `cap-exceeded` wording edit) whose generated output was stale. The regenerated file is
correct for the source that exists and `validate:contracts` needs it, so it was left in place —
but it belongs to that session's commit, not this one. Stage explicitly.

## F14 (Critical) — CLOSED 2026-08-17

`cli/src/commands/rollback.ts` wrote `serializeYaml(result.snapshot)` over the whole entry YAML.
Measured worse than the plan recorded: the CLI also RECORDS differently — it snapshots the entire
on-disk YAML (`loadYamlFileSync`) while the server records a projection, so one durable table holds
two structurally different snapshot shapes per resource type, and only the cross-writer combination
loses data.

Fixed by merging rather than replacing: `{...currentData, ...restorable}`. Keys the snapshot omits
keep their current values — the same "left to the writer" posture the server path uses — and the
command now NAMES them, so a partial restore is not reported as a full one.

Two things fell out of the same read:

- **`guidance` must not be written into `gate.yaml`.** It is the body of `guidance.md`; writing it
  in leaves two disagreeing guidance sources, which is exactly why the server's writer carries it
  in `GATE_YAML_EXCLUDED_KEYS`. Added `snapshotKeysNotInEntryFile` to `TYPE_CONFIG`, with
  `system_prompt_guidance` for frameworks on the same reasoning.
- **`cpm rollback style` was a lie.** `singularName(type) as 'prompt'|'gate'|'framework'` cast
  `styles` into a union that does not contain it; nothing records style version rows, so the
  operation could only ever report "version not found". Now refused up front by `isVersionedType`.

Regression test in the CLI workspace (`cli/tests/integration/new-commands.test.ts`), seeded with
the SERVER's snapshot shape since that is the row a real cross-writer rollback reads. Verified RED
against the old `serializeYaml(result.snapshot)` line. CLI suite: 77 passed.

## Tier 5 — OQ-E1 — status: **RULED 2026-08-17 — REJECTED, none of the three recorded options**

The question assumed tree snapshots were worth having and asked only how to reach old rows. Before
ruling, the value was measured. It does not survive the measurement.

### F16 (Critical, design) — a recursive walk of a prompt directory swallows other resources

`TYPE_CONFIG.prompts.nested` is `true`, and chain-step directories are not sub-parts of their
parent — each carries its own `prompt.yaml` and is an independently versioned resource.
`resources/prompts/planning/implementation_plan/` contains six of them (`design/`, `verification/`,
`plan_table/`, `discovery/`, `completion/`, …). A tree snapshot of the parent would capture six
children's bytes, and a rollback of the parent would silently overwrite six resources that have
their own version histories — restoring them to whatever the parent's snapshot happened to hold, at
a version number that means nothing for them.

Tier 5.1 as written ("recursive read of a resource directory to `{relativePath: contents}`, with an
exclusion list") produces exactly this. The exclusion list cannot fix it: the boundary is not a
filename pattern, it is "does this subdirectory contain a `prompt.yaml`", which is resource-graph
knowledge a filesystem walker was specified not to have.

### The value is near zero, measured

Files in a resource directory that its writer does NOT already own:

| Type       | Resource dirs | Unowned files                                                                    |
| ---------- | ------------- | -------------------------------------------------------------------------------- |
| gates      | 25            | **0**                                                                            |
| frameworks | 8             | **0**                                                                            |
| prompts    | 121           | `tools/` in **7** (5.8%); everything else is writer-owned or a separate resource |

So a tree snapshot buys gates and frameworks nothing at all — their writers already emit every file
in the directory — and buys prompts one subdirectory in 7 of 121 cases. Against that: a durable
snapshot-format change, a permanent second read path, a size ceiling, and F16.

### The retirement condition in the recorded default was unreachable anyway

The default proposed keeping the object path "until no object-era row remains within
`max_versions` reach". Pruning is per-resource and keeps the newest 50 (`config.json: 50`), so an
object-era row only ages out after 50 post-E edits **of that resource**. Most gates and frameworks
are edited a handful of times, so the condition would never fire and the dual path would be
permanent — a retirement condition that cannot be observed is the shape `cleanup-standards.md`
calls a bug.

(A durable store legitimately reads more than one format forever; that is what durability means,
not debt. The error was pricing it as temporary, which made a permanent path look cheap.)

### Ruled

**Do not adopt tree snapshots.** Tier 5 is closed as rejected-with-evidence, not deferred. Revisit
only if script tools become widely used (the 7/121 figure is the trigger to re-measure) or a
measured incident shows a rollback losing tool state.

**F7 is closed differently — by disclosure, not by versioning.** A prompt rollback now reports the
script tools it did not restore. Versioning them would require the projection to read
`tools/{id}/{tool.yaml,schema.json,script.*}` from disk, making a pure projection do I/O and
changing the durable snapshot format, for a Low-severity defect in 5.8% of prompts. Silence about
it was the part that was actually wrong: a partial restore reported as a full one is the defect
class this change exists to remove, and it does not stop being one because the missing part is a
file rather than a field. This matches what the framework contract's `unrecordedFields` and the
CLI's `not_restored` now do.

## Tier 6 — OQ-F1 — status: **RULED 2026-08-17 — defer (recorded default)**

Adding a read-scope override widens `resource_manager`'s reachable-shape union, which this repo's
Public API Contract prices as breaking. There is no measured demand: no incident, no request, and
no code that wants it. The reasoning that settled `version_description` by deletion applies
directly — a parameter added against a hypothetical is the thing that becomes typed, read, and
unreachable. Tier 6 stays unimplemented until a major version is otherwise warranted, at which
point it ships alongside the `gate_verdict` string-branch retirement.

## Tier 7 — OQ-G1 — status: **RULED 2026-08-17 — defer to the next major (recorded default)**

Relocating `session cancel` removes a member from `system_control`'s union and adds one to
`prompt_engine`'s. Both halves are breaking. Bundling it with the `gate_verdict` string-branch
retirement and any OQ-F1 outcome means one major absorbs every union change rather than three
majors carrying one each. The alternative — add now, deprecate in place — buys ergonomics at the
cost of a period where both exist, and this plan's whole subject is removing exactly that shape.

The rule that decides the placement is already recorded in the plan (which id the caller holds) and
is what stops the split re-forming; nothing about deferring the move weakens it.

### DEV-T0-2 — integration tests need the ESM flag

`npx jest <integration path>` fails to parse `tests/setup.ts` (`Identifier '__dirname' has already
been declared`). Integration tests must run as
`NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBand …`, matching the `test:integration`
script. Every Verify command in the plan that names a bare `npx jest` on an integration path needs
the prefix.

## Measurements taken during execution

| What                                                | Value                                                     | When                                            |
| --------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| prompt tree sizes (101 trees)                       | p50 7,143 B · p95 29,132 B · max 74,336 B · mean 11,630 B | 2026-08-17, planning                            |
| gate tree max                                       | 7,934 B                                                   | 2026-08-17, planning                            |
| ESLint on the 5 scoped files                        | 58 errors / 23 warnings, **zero** cognitive-complexity    | 2026-08-17, planning                            |
| `src/mcp/tools/index.ts`                            | 1,217 lines                                               | 2026-08-17, planning                            |
| `state.db` delta after 50 edits of the largest tree | —                                                         | ☐ (as of 2026-08-17 · flips at the Tier 5 gate) |

## Final verify — the live drive earned its place

`npm run build` + `verify:mcp` → **17/17**, annotations read back off `tools/list`. Then a real
STDIO drive against a registered gate (`code-quality`, backed up and restored byte-for-byte; md5s
verified, git reports it unmodified). Two findings the whole green suite did not produce:

### F18 (High) — **OPEN, introduced by Tier 3** — every gate/framework edit writes a bridge row

The live history read:

```
| 4 (latest) | +2/-2  | Update via resource_manager |
| 3          | -      | Bridge: prior live state (era transition or out-of-band edit) |
| 2          | +2/-11 | Update via resource_manager |
| 1          | -      | Bridge: prior live state (era transition or out-of-band edit) |
```

A bridge before edit 1 is correct — the era transition. A bridge before edit **2** is not: edit 1
had just recorded the produced state, so the live state should have matched it.

**Cause: key ORDER.** `latestSnapshotMatches` compares `JSON.stringify(entry.snapshot) ===
JSON.stringify(live)`, which is order-sensitive. The two projections emit the same keys in
different orders:

- `gateSnapshotContract.project` → `id, name, type, description, guidance, pass_criteria, activation, retry_config`
- `projectWriteModel` → declared order, i.e. `…, description, pass_criteria, activation, retry_config, guidance`

So the strings never match and every edit bridges. Frameworks have the same shape (`{...base, id}`
preserves the base's insertion order and appends the rest). Consequence is row growth at 2× and a
history full of meaningless bridge rows — not data loss, and rollback targets are still correct,
but it defeats the "steady state records exactly one row per edit" property `recordEditResult`
documents.

**Fix (not yet applied)**: add a `canonicalizeSnapshot(record, projectedFields)` to
`snapshot-contract.ts` that re-emits keys in declared order, and apply it at the end of BOTH
`project()` and `projectWriteModel` in all three contracts — so the ordering cannot be got wrong
per-contract. Prompts are unaffected today only because both sides call `canonicalPromptSnapshot`.
Acceptance: drive two consecutive updates and assert the history contains exactly one bridge row,
not one per edit. An integration assertion on bridge-row count belongs with it — the existing tests
assert snapshot CONTENT and are blind to this.

### F17 (High) — **OPEN, pre-existing** — a gate created through `resource_manager` is invisible until restart

Measured 2026-08-17 on the live STDIO path: `create` reports success and writes both files, then
every subsequent action on that id — `update`, `reload`, `history`, `inspect`, `rollback` — answers
"Gate 'X' not found". An explicit `action:"reload"` does not fix it. The registry only learns about
the gate on server restart.

Not caused by this initiative: the diff for `gate-lifecycle-processor.ts` touches only the
versioning block in `handleUpdate` and the `dry_run` branch in `handleDelete`; `handleCreate`, the
refresh call, and `manager.ts` are unchanged. This is why the live drive had to run against a gate
registered at startup, and it means the plan's Final Verify ("create a gate, update twice, …")
cannot be performed as written until F17 is fixed.

### What the drive DID confirm

| Behaviour                                | Result                                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Go-forward numbering on a gate, live     | version 2 and 4 hold "Update via resource_manager" — the produced state                                                          |
| Router confirm guard, live               | `rollback` without `confirm` refused before dispatch                                                                             |
| `dry_run` rollback, live                 | rendered the diff, wrote no file, recorded no row — `gate.yaml` still held the pre-rollback state afterward                      |
| Field preservation across the whole path | `pass_criteria`, `activation`, `retry_config` intact after two updates — the writer's carry-forward survives the contract change |
| MCP annotations over STDIO               | `destructiveHint` present on all three tools                                                                                     |

### DEV-T5-1 — `MCP_WORKSPACE` is not honoured for the resources directory

The drive first ran with `MCP_WORKSPACE` pointed at a temp copy; the server wrote into the REPO's
`server/resources/gates/` instead. Pre-existing and out of scope, but it means a live drive cannot
be sandboxed that way — back up and restore the real files instead. The stray probe gate was
removed and `git status` on `server/resources/` verified clean.

## Tiers 6 + 7 — operator override, same PR, breaking major

**2026-08-17**: the operator directed both tiers into this PR, overriding the defer rulings recorded
above. Both were ruled "defer to the next major" on cost grounds, not on correctness; the operator's
decision replaces that trade-off, and the reasoning is kept above rather than rewritten so the next
reader sees what was weighed. This release is now a **breaking major** — both tiers change the
reachable-shape union of the MCP tool surface, marked in `CHANGELOG.md` under `### ⚠ BREAKING
CHANGES` per `ci-release.md`.

### F18 — CLOSED. The first test written for it could not fail

Fixed with `canonicalizeSnapshot(record, projectedFields)`, applied at the end of `project()` in the
gate and framework contracts and inside `projectWriteModel`, so the two directions agree by
construction rather than by each implementation remembering to.

**The test was insensitive twice before it was real**, and the reason is worth recording:

1. First mutation attempt reverted `projectWriteModel`'s canonicalization — green. That side builds
   `{...base, id}` then copies in `projectedFields` order, which for a gate with no base already IS
   declared order. Wrong side.
2. Second attempt reverted `project()` — still green. The fixture gate declared no `pass_criteria`,
   `activation` or `retry_config`, so both projections emitted the same five required keys in the
   same order. **The divergence only exists once an optional key is present**, because the optional
   keys sit between `description` and `guidance` in the declared order and after `guidance` in the
   old hand-built one.

Adding `pass_criteria` to the fixture made it red: `Expected: 1, Received: 2` — two rows per edit.
This is `testing.md`'s "bound asserted with a fixture inside the bound" in a new shape: the fixture
was inside the region where the two orderings coincide. A test written for an ordering bug has to
carry a field whose position differs.

`pass_criteria: [{ required_patterns: ['ALPHA'] }]` was also rejected by resource validation (found
in the live drive, then again here); the accepted shape carries `type`, e.g.
`{ type: 'inline_guidance', min_length: 10, required_patterns: ['ALPHA'] }`. The declared
`GateManagerInput['pass_criteria']` element type does not include the `guidance` key that
`resources/gates/*/gate.yaml` files actually use — a type/schema drift, noted not fixed.

### DEV-T6-1 — the prompt contract is deliberately NOT canonicalized

Applying `canonicalizeSnapshot` to `promptSnapshotContract.project` would have changed what a prompt
snapshot CONTAINS, not just its order: `id` and every `SNAPSHOT_PRESERVED_FIELDS` member sit outside
`projectedFields` and would have been dropped. `version_history` is durable, so every existing
prompt row would stop matching and bridge once. Prompts never had the ordering bug — both sides call
`canonicalPromptSnapshot` — so uniformity would have cost row rewrites for nothing.

### DEV-T7-1 — `system_control session cancel` refuses by name rather than falling through

Removing the case would have dropped it into the generic `Unknown session operation` branch. A
caller reaching for `cancel` here is not confused about the vocabulary — they are using the
interface that used to have it — so a bare "unknown operation" would send them hunting for a typo.
The refusal names `prompt_engine(chain_id, cancel: true)` and states the id-holding rule.

### DEV-T7-2 — four relocated tests were rewritten, not deleted

`session-action.test.ts` had four `cancel` tests (routing, idempotence, terminal-state refusal,
missing-id throw) and `session-action-handler.test.ts` one more. The behaviour they covered now
belongs to `prompt_engine` and is covered there; what remains true on the old surface is that the
operation is gone and says where it went, which is what they assert now. Recorded so the coverage
delta is a decision rather than an accident.

### DEV-T7-3 — CHANGELOG entries from earlier this session were destroyed by a concurrent write

The Tiers 3-4 entries added to `## [Unreleased]` earlier were gone when Tier 7's entry was written:
a concurrent session rewrote `CHANGELOG.md`, adding its own `## [Unreleased]` at the top of the file
and dropping the content that had been added to the pre-existing one at line 224. Re-added, merged
into the new top section, and its duplicate `### Added` heading folded into one.

This is the second instance of the same hazard this initiative has hit (the first cost a plan
writeback). **Uncommitted work in a shared worktree is volatile — commit narrative artifacts as soon
as they are written**, not at the end of the tier. HEAD's `CHANGELOG.md` still carries a second,
empty `## [Unreleased]` at line 224; it predates this session and was left alone.

### DEV-T7-4 — `cancel` was structurally dead on the wire, and the live drive is what found it

Three separate defects, all invisible to a green suite of 2,629 tests:

1. **The parameter never arrived.** `index.ts`'s `normalizedArgs` is an explicit ALLOWLIST, not a
   spread, so `cancel` was dropped between the validated schema and the executor. It typechecked at
   every layer. **This is the third instance of this exact class in this initiative** —
   `version_description` (F6), `dry_run` on the gate and framework routes (DEV-T4-1), and now this.
   The allowlist now carries a comment saying so.
2. **`cancelChain` is keyed on the internal session id**, not the resume token. `chain_id` is
   `chain-content_analysis#1`; the store wanted `review-content_analysis-1786998494932`. Resolving
   one to the other via `getSessionByChainIdentifier` is not a detail of the relocation, it IS the
   relocation — the old `system_control` operation took the internal id, so stopping your own run
   meant listing sessions to look up an identifier you never chose.
3. **The scope posture I wrote was more careful and strictly worse.** `resolveRequestScope` fell
   back to `this.workspaceScope` when the request carried none. `getSessionForMutation` SKIPS the
   scope check on `undefined` and ENFORCES it on a value, so a session with no `continuityScopeId`
   compared unequal to the substituted one and every cancel returned "not applied". The relocated
   handler returned `undefined`; mirroring it exactly was the fix.

Each of the three would have shipped. The unit tests pass a mock store whose `cancelChain` resolves
`true` regardless of its arguments, so none of them can observe any of this. Two assertions were
added afterward to pin (2) and (3) — written from the live evidence, not before it.

### Tiers 6 + 7 result

| Gate                              | Result                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`               | clean (2 pre-existing errors in the concurrent session's `chains/manager.ts` + `sqlite-engine.ts`, untouched here)                                                                                                                                                                                                                    |
| `npm test`                        | 198 suites · 2,629 passed · 1 skipped                                                                                                                                                                                                                                                                                                 |
| `npm run lint:ratchet`            | OK — 3174/1008, no regressions                                                                                                                                                                                                                                                                                                        |
| `npm run typecheck:tests:ratchet` | OK — 371, improved from 375                                                                                                                                                                                                                                                                                                           |
| `npm run validate:arch`           | OK — 466 modules, 0 errors                                                                                                                                                                                                                                                                                                            |
| `npm run validate:contracts`      | clean after `generate:contracts`                                                                                                                                                                                                                                                                                                      |
| CLI workspace                     | typecheck clean · 77 tests passed                                                                                                                                                                                                                                                                                                     |
| `npm run verify:mcp`              | **17/17**                                                                                                                                                                                                                                                                                                                             |
| **Live drive, STDIO**             | `tools/list` advertises `cancel` and `source_workspace`; `source_workspace` accepted on `history`, refused on `rollback`; `system_control session cancel` refuses and names the replacement; `prompt_engine(cancel:true)` without `chain_id` refuses; start → cancel → resume returns `Chain run already complete. Status: cancelled` |

## Closeout pass — 2026-08-17 (three open items + plan hygiene)

Ran after the eight-commit merge to `main`, to close what an audit found still open before the plan
was retired to `reference`.

### DEV-T8-1 — the vacuous-pass guard caught my own harness, not the product

The fault-injection test asserts `expect(spy).toHaveBeenCalled()` so that an untouched file counts
as evidence about ORDER rather than about the edit having been rejected upstream. It failed on the
first run with `Received number of calls: 0` — and the fault had in fact fired, visible in the
response text (`Failed to save version: disk full`).

Cause: `spy.mockRestore()` in the `finally` block resets `mock.calls` along with the implementation,
so the assertion ran against a cleared record. Fixed by reading `spy.mock.calls.length` into a local
**before** the restore.

Worth keeping because the guard did its job in an unexpected direction: without it the test would
have passed for the wrong reason if the update had ever started failing earlier in the path, and I
would not have learned that `mockRestore` is destructive to the evidence.

### DEV-T8-2 — a framework switch is not a witness for re-registration

Item 2 of the audit was "Tier 1.5 was marked ✓ by reading SDK source, not by driving it". The first
drive did exactly what the plan row specified — switch the framework over Streamable HTTP, re-list
tools, compare annotations — and reported PASS on all three tools.

It proved nothing. Comparing tool DESCRIPTIONS before and after the switch showed `UNCHANGED` on all
three, so nothing observable about the tool surface had moved, and "annotations survived
re-registration" was indistinguishable from "no re-registration happened". That is the same shape as
the three structurally-dead parameters this initiative already found, arriving in the verification
rather than in the code.

Re-driven through the gate-system toggle instead, which is wired to
`setToolSurfaceChangedHandler` → `reregisterToolsWithUpdatedDescriptions`, and whose effect is
visible: `gates`, `gate_verdict` and `gate_action` disappear from `prompt_engine`'s advertised
schema while gates are off. With that witness in hand the annotation comparison means something.
Result: re-registration ran, all three tools kept their annotations, gate system restored afterward
(11 parameters before, 11 after).

The drive script also required a correction — `operation: 'off'` is not in the vocabulary
(`enable`, `disable`, `status`, `health`, `list`), which the server reported cleanly.

### DEV-T8-3 — `HANDLER_OWNED_CONFIRMATION`'s doc comment was false

The constant asserts "Every entry is covered by a handler-level test asserting the guard still
refuses". `rg deletePrompt tests/` returned zero hits — its sole entry had no such test.
`router.test.ts` covers the router STANDING DOWN for that pair, which is the complementary
obligation and not this one.

Added two tests in `prompt-lifecycle-processor.test.ts`. The load-bearing assertion is the blast
radius (`2 prompt(s) reference it`, naming both chains and excluding the unrelated one), because
that is the only thing justifying the bypass entry: if the handler's refusal said nothing the router
could not, the entry should be deleted rather than tested. Both red when the guard is disabled.

### Hygiene applied to the plan file

| Edit                                                         | Why                                                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Tier 5 rows 5.0-5.4 `☐` → `⊘` with `verified` stamps         | The tier was rejected on measurement; `☐` reads as outstanding work to every reader and gate   |
| F7 done-criterion no longer points at task 5.3               | F7 closed by disclosure; the criterion described a mechanism that was refuted                  |
| Dropped the `sqlite-persistence.md` documentation row        | It promised to document a Tier 5.2 discriminator that will not exist                           |
| Dropped three Tier-5 rows from the testing strategy          | Same reason                                                                                    |
| Widened the Changelog entry                                  | It omitted the cancel relocation, `source_workspace`, F14 and F15 — narrower than what shipped |
| Tier 1.5 and the two done-criteria rows carry their evidence | A `✓` with no observation behind it is what this pass existed to find                          |
| `status: active` → `reference`                               | Everything not rejected is landed; what remains was promoted out                               |

### Promoted out rather than closed here

- **F17** → `plans/techincal_debt/gate-registry-refresh-on-create-2026-08-17.md` (`backlog`). It is
  pre-existing, High, and blocks the parent plan's Final Verify in its `create`-first form. Left in
  an implementation-notes appendix it would have been findable only by someone already reading this
  file.
- **Phase 4c growth capture** — owed against the whole PR, not against a plan being retired. Two of
  the five patterns are past the 3-sighting bar; recorded in the plan's Growth capture section.
