---
title: "Resource versioning consolidation — one snapshot contract, one destructive posture"
date: 2026-08-17
status: reference
tags:
  - versioning
  - mcp-tools
  - resources
  - gates
  - frameworks
---

# Resource Versioning Consolidation (A–F)

**Area**: `server/src/modules/versioning/`, `server/src/mcp/tools/{resource-manager,gate-manager,framework-manager}/`, `server/src/cli-shared/version-history.ts`, `server/tooling/contracts/resource-manager.json`
**Work type**: refactor (secondary: bug_fix)
**Risk**: medium — durable `version_history` table, rows from multiple semantic eras coexisting, a declared second writer that must move in lockstep
**Origin**: operator question 2026-08-16 on how to test `resource_manager` history/versioning/rollback; discovery found the three resource types disagree on what a version number means

## Findings Ledger

`resource_manager` exposes `history` / `rollback` / `compare` uniformly across prompt, gate, and
framework, but only the prompt path was migrated to go-forward semantics (P7). Every finding below
was measured against `src/`, not inferred.

| id  | Severity                | Finding                                                                                                                                                                                                                                                                                                                              | Evidence                                                                                                                                                                                                             |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Critical**            | Gates and frameworks record the state each edit _preceded_, not the state it produced. The state produced by the most recent edit is recorded in no row at all, so it is not rollback-reachable until the next edit happens.                                                                                                         | `gate-lifecycle-processor.ts:113`, `framework-lifecycle-processor.ts:158` call `saveVersion(beforeState)`; prompts call `recordEditResult` at `prompt-lifecycle-processor.ts:549`                                    |
| F2  | **Critical**            | Gate and framework rollback substitute live values for missing snapshot fields, landing on a state matching neither the target version nor the current one. This is the hybrid-state merge deliberately removed from the prompt path.                                                                                                | `gate-versioning-processor.ts:71-74`, `framework-versioning-processor.ts:91-94` use `snapshot['x'] ?? existingResource.x`; the prompt path returns `missingFields` instead (`prompt-versioning-processor.ts:75`)     |
| F3  | **High**                | A refused rollback still writes history rows, on **all three** types. `rollback()` calls `recordEditResult` before the caller validates restorability. The prompt path admits it in its own error text.                                                                                                                              | `version-history-service.ts:372` calls `recordEditResult` (322); `prompt-versioning-processor.ts:202` validates afterward                                                                                            |
| F4  | **High**                | The `confirm` guard is duplicated across six processors in two idioms, with no pre-dispatch check. Six chances to forget one.                                                                                                                                                                                                        | `gate-versioning:39`, `gate-lifecycle:163`, `framework-versioning:44`, `framework-lifecycle:213`, `prompt-versioning:150`, `prompt-lifecycle:668`                                                                    |
| F5  | **Medium**              | No MCP tool annotations are set anywhere, so clients cannot gate destructive actions where the human is.                                                                                                                                                                                                                             | `rg "destructiveHint\|readOnlyHint\|idempotentHint" src/mcp/` → zero hits; `registerTool` at `index.ts:748, 934, 991` passes only `{title, description, inputSchema}`                                                |
| F6  | **Medium**              | `version_description` is typed and read but unreachable — the router's explicit allowlists drop it. Declaration-live, value-dead. _(Corrected during discovery: the top-level schema is `.passthrough()` at `resource-manager.schema.ts:266`, so Zod admits it; the router is what strips it.)_                                      | typed at `gate-manager/core/types.ts:56`, `framework-manager/core/types.ts:196`; read at `gate-lifecycle:118`, `framework-lifecycle:163`; absent from `routeToGateManager` (190) and `routeToFrameworkManager` (272) |
| F7  | **Medium**              | **CLOSED 2026-08-17 by disclosure, not by versioning** (OQ-E1 ruled — 7 of 121 prompt dirs declare tools; versioning them would make a pure projection do I/O and change the durable snapshot format). Script tools are not versioned. A prompt rollback restores the template and leaves `tools/{id}/` at whatever it currently is. | `validation.ts:590` — `tools` deliberately excluded from `canonicalPromptSnapshot`                                                                                                                                   |
| F8  | **Low**                 | `dry_run` exists only on prompt update. `rollback` — a confirm-gated destructive action — has no preview at all.                                                                                                                                                                                                                     | `resource-manager.schema.ts:157`, `prompt-lifecycle-processor.ts:526`                                                                                                                                                |
| F9  | **Low**                 | `tests/manual/test-versioning.ts` asserts `.history.json` sidecar files that SQLite replaced. It documents a storage model that no longer exists.                                                                                                                                                                                    | 202 lines, header comment names the sidecar                                                                                                                                                                          |
| F10 | **Critical (coverage)** | Nothing reaches `GateVersioningProcessor` or `FrameworkVersioningProcessor` through the real write path. F1 and F2 are invisible to the suite; a green run is evidence about coverage, not correctness.                                                                                                                              | `version-history-workflow.test.ts` exercises gate/framework only at the service level (lines 263, 384, 784); the prompt real write path is covered at 537-773                                                        |

Two findings surfaced during execution rather than planning:

| id  | Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Evidence                                                                                                                                                                                             |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F11 | **Low**  | `deleteHistoryFile` (`cli-shared/version-history.ts:667`) is named for the retired sidecar model but actually issues a `delete_history` SQL request against `version_history`. It is live and load-bearing — deleting a resource directory purges its version rows — but its name sends anyone grepping for sidecar cleanup to a SQL function, and anyone grepping for "what deletes version_history rows" past it entirely. Rename, do not delete.                | `resource-scaffold.ts:359` calls it inside `deleteResourceDir`; the body runs `runSqlite({... 'delete_history'})`                                                                                    |
| F12 | **High** | The confirm-guard duplication is wider than F4 measured: `system_control` carries three more hand-written `!args.confirm` guards, and **two destructive actions with no guard at all** — `session clear` and `session cancel`. `clearSession` removes "all state and artifacts", and when the id matches no session it **silently falls through to `clearSessionsForChain(id)`**, escalating a typo'd or stale id from one session to every session on that chain. | `config-action-handler.ts:41`, `analytics-action-handler.ts:44`, `maintenance-action-handler.ts:23`; unguarded at `session-action-handler.ts:21,25`; escalation at `session-action-handler.ts:82-95` |

| F13 | **High** | `tests/unit/mcp-tools/system-control/session-action.test.ts` (236 lines) is titled "session action scope propagation" and establishes scope by passing `{ organizationId: 'org-acme' }` as the MCP `extra`. `resolveRequestIdentity` reads **auth claims**, not a bare property, so that input resolves to `organizationId: 'default'` and `extractScope` returns `undefined`. Every scope assertion in the file was vacuous, and its concurrency test — whose mock branched on `options.continuityScopeId` — compared two requests that resolved to the _same_ scope, so the isolation it claimed could not have been observed. | probed 2026-08-17: `resolveRequestIdentity({organizationId:'org-acme'})` → `{"organizationId":"default","identitySource":"default"}`; `session-action.test.ts:212` mock reads an argument the handler never passed |

| F15 | **High** | `resource_manager framework update description:"…"` reported a successful change the file never received. `description` is declared on `FrameworkCreationData`, carried in `OPTIONAL_FRAMEWORK_FIELDS`, read back by `toFrameworkCreationData` and shown in the update diff, but `buildFrameworkYamlData` never emitted it — the old value survived because `writeFrameworkFiles` deep-merges over the existing YAML. Surfaced through versioning: the snapshot recorded a field no write path could restore. **Fixed 2026-08-17** in the writer. | `rg -n "description" framework-file-writer.ts` returned only `rawDescription` (read path, 211/217) and `tool_descriptions`; `yamlData['description']` did not exist |
| F16 | **Critical (design)** | A recursive tree snapshot of a PROMPT directory captures nested chain-step prompts, which are separately versioned resources with their own histories — a parent rollback would silently overwrite them at a version number that means nothing for them. This refutes Tier 5.1 as specified; the boundary is "does this subdirectory contain a `prompt.yaml`", which is resource-graph knowledge a filesystem walker was specified not to have. | measured 2026-08-17: `resources/prompts/planning/implementation_plan/` contains six child prompts (`design/`, `verification/`, `plan_table/`, `discovery/`, `completion/`, …), each with its own `prompt.yaml`; `TYPE_CONFIG.prompts.nested` is `true` |
| F14 | **Critical** | `cpm rollback` writes the recorded snapshot as the ENTIRE resource YAML (`cli/src/commands/rollback.ts:68-73` — `serializeYaml(result.snapshot)` → `writeFileSync`), bypassing the field-preserving writers the server path uses. A server-recorded **gate** snapshot holds `{id, name, type, description, guidance}`; `gate.yaml` declares `{id, name, type, description, guidanceFile, pass_criteria, retry_config, activation}`. So a CLI rollback of a gate **deletes** `pass_criteria`, `retry_config`, `activation` and `guidanceFile`, and writes a bogus `guidance` key holding the whole markdown body. Server and CLI rollback produce different files from the same version. | measured 2026-08-17: `gate-lifecycle-processor.ts:71-77` snapshot keys vs `resources/gates/code-quality/gate.yaml` declared keys |

**Root cause behind F2, F7, and the `SNAPSHOT_FIELDS_LEFT_TO_THE_WRITER` complexity**: the snapshot
is a projection of a parsed in-memory object rather than the bytes on disk. What is on disk is
authored by definition, so a byte-level snapshot has no resolved-versus-authored problem and no
required-fields set. Item E addresses this; OQ-E1 is the cost.

## Intent (discovery)

```
work_type     : refactor
secondary     : bug_fix
confidence    : high
scope         : src/modules/versioning/version-history-service.ts · src/cli-shared/version-history.ts ·
                src/mcp/tools/resource-manager/core/router.ts · src/mcp/tools/index.ts ·
                src/mcp/tools/{gate-manager,framework-manager}/services/*-{versioning,lifecycle}-processor.ts ·
                src/mcp/tools/resource-manager/prompt/services/prompt-versioning-processor.ts ·
                tooling/contracts/resource-manager.json · tests/{integration,e2e}/
risk          : medium — durable version_history; rows from multiple semantic eras coexist with
                nothing per-field to tell them apart; a declared second writer must move in lockstep
external_deps : none
source_spec   : none — originated from an operator question, findings measured directly against src/
problem       : three resource types share one tool surface and one durable table but disagree on
                what a version number means, on whether restore may read live state, and on whether
                a refusal mutates → one snapshot contract, one destructive posture, refusals write nothing
next_phase    : design
```

`domain_ownership`: `VersionHistoryService` (`src/modules/versioning/`) owns numbering, persistence,
prune, and scope. The three `*VersioningProcessor` classes own projection and restore.
`ResourceManagerRouter` owns dispatch and arg transformation. `src/cli-shared/version-history.ts` is
a declared second writer mirroring `recordEditResult` line-for-line.

`sibling_patterns`: `canonicalPromptSnapshot` + `REQUIRED_SNAPSHOT_FIELDS` +
`buildRestoreFromSnapshot` is the reference implementation Tier 3 generalizes.
`resolvePreservedGateYamlFields` (`gate-file-writer.ts:84`) is the correct-by-contrast live read
that must be **preserved**, not deleted alongside the merges.

## Pre-flight (design)

Probed, not recalled. Two failures, resolved below.

| Check                 | Result   | Probe                                                                                                                                                                                |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| domain                | pass     | `rg "recordEditResult\|saveVersion" src/` → boundary already correct; two processors do not honor it                                                                                 |
| layer                 | pass     | service logic stays in `modules/versioning`; processors stay thin                                                                                                                    |
| naming                | pass     | `rg "requiresConfirm\|destructive" src/` → `requiresConfirmation` exists in `modules/automation/`; new registry named `DESTRUCTIVE_ACTIONS` / `assertConfirmed` to avoid the homonym |
| complexity            | pass     | `npx eslint` on 5 scoped files → 81 problems, **zero** `sonarjs/cognitive-complexity`, zero `max-depth`, zero `max-params`; all 58 errors are typing rules                           |
| size                  | pass     | 502 / 721 / 415 / 143 / 169 / 300 — none near 1000                                                                                                                                   |
| service               | pass     | `rg "export.*Snapshot" src/` → no snapshot-contract service exists to extend                                                                                                         |
| defined               | pass     | `rg -il "SnapshotContract\|SnapshotProjector\|ResourceSnapshot" src/` → no hits                                                                                                      |
| **contracts**         | **FAIL** | processors take `args: any`; a snapshot contract cannot be type-checked across that boundary                                                                                         |
| pattern               | pass     | OOP shell orchestrates, FP internals project/restore                                                                                                                                 |
| **reuse-scope**       | **FAIL** | confirmation-gating already exists as a capability in `modules/automation/`                                                                                                          |
| persistence           | pass     | `saveVersion` throws by design; record-before-write ordering preserved; no schema change                                                                                             |
| lib-api / lib-version | n/a      | `external_deps: none`                                                                                                                                                                |

**Compound diagnosis**: _Capability overlap at an untyped boundary_ → resolve the reuse question
before extraction, and type the boundary in the same tier that introduces the contract, or the
contract is decorative.

- **reuse-scope resolved as intentional duplication.** `requiresConfirmation` gates _script tool
  execution_ discovered by trigger matching — input `ToolMatch`, consumer the execution pipeline,
  default `confirm ?? true`. The new registry gates _MCP resource actions_ by name — input a router
  arg, consumer dispatch, default deny. Different domain, input type, consumer, and default.
  Recorded so the next reader does not re-litigate it.
- **contracts resolved by typing in Tier 3.7**, not deferred. `args: any` is why the gate and
  framework merges went unnoticed.

**Identification** (behavior before shape): the thing being created is a **snapshot contract** — a
declaration of what constitutes a complete recorded state and how it projects from and restores to
disk. State: none, so the shape is a module of pure functions behind one interface, not a class.
Placement: interface in `modules/versioning`, per-type implementations beside their processors to
respect the layer constraint at `validation.ts:590`. Item E dissolves that split, since a tree
walker has no domain knowledge.

**Rejected alternatives**: going straight to E (larger blast radius on a durable table, leaves gates
and frameworks broken longer); `isomorphic-git` as the store (would re-do workspace-scoping and
durable-table work that is already correct, and puts git error paths inside an MCP tool — revisit
only if branching or user-inspectable history becomes a requirement).

## Verified paths

All 20 cited files exist; none is a re-export shim (smallest is 89 lines). Two Design-step
citations drifted and are corrected here:

- `resource-manager/core/router.ts` — **190-345**, not 220-340. `routeToGateManager` begins at 190,
  `routeToFrameworkManager` at 272, `confirm` pass-throughs at 242 and 330, the `resource_type`
  switch at 80. Item A's guard belongs above line 80, not inside a method body.
- `version-history-service.ts` — `recordEditResult` at **322**, not ~300. `latestSnapshotMatches`
  350, `rollback` 372, `compareVersions` 423, `saveVersion` 122, `loadHistory` 207, `getVersion` 249.

Two facts the design did not anticipate:

- `src/mcp/tools/index.ts` is **1,217 lines**, past the 1000-line threshold at which size escalates
  when it co-occurs with another signal. Tier 1 adds ~25 lines to it; decomposition is out of scope
  and named so it is not discovered as a surprise.
- The conformance registry-staleness warning spans lines **24-29**, not 26-28.

## Measurement — settles item E's encoding

```
101 prompt trees   p50 7,143 B   p95 29,132 B   max 74,336 B   mean 11,630 B   total 1,174,693 B
gate trees         max 7,934 B
```

At `max_versions: 50`, a p95 prompt tree costs roughly 1.46 MB and the largest roughly 3.7 MB.
Inline bytes in the existing `snapshot` column stay within single-digit MB per resource and tens of
MB for the whole corpus at full retention. That is affordable without a blob table, its
`TableContract`, its durability posture, and its orphan-GC class. **Adopt inline bytes with a 1 MB
per-snapshot refusal ceiling** — 13× headroom over the measured max. Refusing loudly beats
truncating silently, which is the defect class item C exists to remove.

## Safety property that must survive

The version row is recorded **before** the file write on purpose, so a persistence failure aborts
the edit with nothing on disk. Do not move recording after the write. The target is three phases,
not two:

```
validate (pure, no writes)  →  record version (throws → abort)  →  write file
```

## Plan Table

### Tier 0 — Close the coverage gap; tests reach the defective write paths and go red

| #   | St  | File                                                                              | Change                                                                                                                                                         | ~Lines         | Depends | Verify                                                                                                  | Justification                                                                                                                |
| --- | --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | ✓   | `tests/integration/mcp-tools/gate-framework-versioning.integration.test.ts` (NEW) | Drive `GateVersioningProcessor` + `FrameworkVersioningProcessor` through the real write path: create → update → update → history → rollback → reload → inspect | ~260           | —       | `npx jest gate-framework-versioning` — restore-fidelity assertions FAIL against HEAD; paste the failure | F10. The merges at gate 71-74 and framework 91-94 are invisible to the suite today                                           |
| 0.2 | ✓   | same file                                                                         | Add `countVersionRows(db, type, id)` and a refused-rollback case asserting the count is unchanged                                                              | ~40            | 0.1     | FAILS against HEAD — the refusal path writes a bridge row and a restore row                             | This is Tier 2's acceptance criterion; it must exist before the fix                                                          |
| 0.3 | ✓   | `tests/integration/versioning/version-history-workflow.test.ts`                   | Add go-forward assertions for gate and framework: after one update, the newest version equals what `inspect` shows                                             | ~50            | —       | FAILS against HEAD — gates record pre-edit state                                                        | Tier 3's acceptance criterion (F1)                                                                                           |
| 0.4 | ✓   | `tests/manual/test-versioning.ts`                                                 | Delete                                                                                                                                                         | -202           | —       | `rg "\.history\.json" tests/` returns no hits                                                           | F9                                                                                                                           |
| 0.5 | ✓   | `gate-framework-versioning.integration.test.ts`                                   | For each new assertion, remove the mutation under test and record that the assertion reds                                                                      | ~0 (procedure) | 0.1-0.3 | Each removal produces a failure; paste all four                                                         | `workspace-and-mutations.yaml:24-29` records a row that passed while its mutation never ran. Observing green is not evidence |

**Tier 0 gate**: `npx jest tests/integration/mcp-tools/gate-framework-versioning tests/integration/versioning` — expected failures recorded in `implementation-notes.md` with output, each shown red-on-mutation-removal.

### Tier 1 — Item A: one destructive-action guard, tool annotations, dead parameter removed

| #   | St  | File                                                                                                                                                 | Change                                                                                                                                                        | ~Lines | Depends | Verify                                                                                                                                                                                                                                                   | Justification                                                                                                                                                                                                                                                        |
| --- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | ✓   | —                                                                                                                                                    | Probe: `rg -n "gateManager.handleAction\|frameworkManager.handleAction\|promptHandler" src/` to enumerate every entry into the three handlers                 | ~0     | —       | Probe output pasted                                                                                                                                                                                                                                      | Resolves OQ-A1. A router-only guard that leaves a second path unguarded is worse than the duplication it replaced                                                                                                                                                    |
| 1.2 | ✓   | `resource-manager/core/router.ts:80`                                                                                                                 | Add `DESTRUCTIVE_ACTIONS` set + `assertConfirmed(action, args)`; call above the `resource_type` switch                                                        | ~35    | 1.1     | Unit test: every member refuses without `confirm`; a non-member is unaffected                                                                                                                                                                            | F4. Verify-Paths corrected the range — the guard belongs above 80, not inside `routeToGateManager` at 190                                                                                                                                                            |
| 1.3 | ✓   | 6 processors (gate-versioning 39, gate-lifecycle 163, framework-versioning 44, framework-lifecycle 213, prompt-versioning 150, prompt-lifecycle 668) | Replace both inline idioms with the shared `assertConfirmed` import                                                                                           | ~-60   | 1.2     | `rg -n "!confirm\|confirm !== true" src/mcp/tools/` returns no hits                                                                                                                                                                                      | One implementation is the point                                                                                                                                                                                                                                      |
| 1.4 | ✓   | `src/mcp/tools/index.ts:748, 934, 991`                                                                                                               | Add `annotations` to each `registerTool` config: `resource_manager` and `system_control` → `destructiveHint: true`; `prompt_engine` → `idempotentHint: false` | ~15    | —       | `npm run verify:mcp`, then read annotations back off the tool list on both transports                                                                                                                                                                    | F5. Clients gate where the operator is                                                                                                                                                                                                                               |
| 1.5 | ✓   | `src/mcp/tools/index.ts:1078`                                                                                                                        | Apply the same annotations in `reregisterToolsWithUpdatedDescriptions`                                                                                        | ~10    | 1.4     | **Driven 2026-08-17 over Streamable HTTP**: toggling the gate system dropped `gates`/`gate_verdict`/`gate_action` from the `prompt_engine` schema — the witness that re-registration actually ran — and all three tools kept their annotations across it | STDIO pins one server; HTTP builds one per request. Annotations set only at first registration vanish on the HTTP path. A framework switch was tried first and changed no advertised shape, so it could not have distinguished “survived” from “never re-registered” |
| 1.6 | ✓   | `gate-manager/core/types.ts:56`, `framework-manager/core/types.ts:196`, `gate-lifecycle:118`, `framework-lifecycle:163`                              | Delete `version_description` from both types and both reads                                                                                                   | ~-8    | —       | `rg -n "version_description" src/` returns no hits; contracts unchanged                                                                                                                                                                                  | F6. No consumer exists. A labeled-version feature can be proposed deliberately later                                                                                                                                                                                 |

**Tier 1 gate**: `npm run typecheck && npm run lint:ratchet && npm run verify:mcp` plus the Tier 1 unit test. No `_generated/` edits; contracts untouched.

### Tier 2 — Item B: validate, then record, then write

| #   | St  | File                                                                                                                | Change                                                                                                                                        | ~Lines | Depends | Verify                                                                                  | Justification                                                                                                                          |
| --- | --- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | ✓   | `version-history-service.ts:372`                                                                                    | Replace `rollback()` with `resolveRollbackTarget()` (pure read → `VersionEntry \| null`) and `commitEdit()` (wraps `recordEditResult` at 322) | ~60    | —       | Unit test: `resolveRollbackTarget` against a populated table leaves row-count unchanged | Two named methods make "nothing written yet" visible at the call site; a validator callback would hide the ordering inside the service |
| 2.2 | ✓   | `prompt-versioning-processor.ts:175-205`, `gate-versioning-processor.ts:59`, `framework-versioning-processor.ts:72` | Reorder to resolve → validate restore → `commitEdit` → write file → reload                                                                    | ~70    | 2.1     | Task 0.2 goes GREEN on all three types                                                  | F3                                                                                                                                     |
| 2.3 | ✓   | `src/cli-shared/version-history.ts:435`                                                                             | Mirror the same ordering in the rollback case                                                                                                 | ~35    | 2.1     | `npx jest tests/unit/cli-shared/version-history.test.ts`                                | Declared second writer of one durable table; divergence is silent                                                                      |
| 2.4 | ✓   | `prompt-versioning-processor.ts`                                                                                    | Delete the "pre-rollback snapshot was already recorded as version N" sentence from the refusal message                                        | ~-3    | 2.2     | Message no longer claims a write occurred                                               | A status outlives what it described; leaving it makes the message a lie                                                                |

**Tier 2 gate**: `npm test -- version-history` fully green including task 0.2; `npm run typecheck:tests:ratchet`.

### Tier 3 — Item C: one snapshot contract, no live-value substitution

| #   | St  | File                                                                            | Change                                                                                                           | ~Lines | Depends  | Verify                                                                                                                                  | Justification                                                                                                                     |
| --- | --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | ✓   | `src/modules/versioning/snapshot-contract.ts` (NEW)                             | Declare `SnapshotContract<TLive>`, `RestoreResult`, and a `Map<ResourceType, SnapshotContract>` registry         | ~70    | —        | `npm run typecheck`                                                                                                                     | See new-file justifications                                                                                                       |
| 3.2 | ✓   | `prompt-versioning-processor.ts:18-95`                                          | Implement the interface over the existing constants; keep them exported so current importers are unaffected      | ~45    | 3.1      | Existing prompt rollback tests stay green with no assertion edits                                                                       | The prompt path is the reference; regressing it while generalizing it would be the worst outcome                                  |
| 3.3 | ✓   | `gate-manager/services/gate-snapshot-contract.ts` (NEW)                         | Real projection over the full authored gate surface, not the 5 inline fields; required set; restore that refuses | ~80    | 3.1      | Task 0.1 restore-fidelity assertions go GREEN                                                                                           | F2                                                                                                                                |
| 3.4 | ✓   | `framework-manager/services/framework-snapshot-contract.ts` (NEW)               | Same for frameworks                                                                                              | ~85    | 3.1      | Task 0.1 framework assertions go GREEN                                                                                                  | F2                                                                                                                                |
| 3.5 | ✓   | `gate-versioning-processor.ts:71-74`, `framework-versioning-processor.ts:91-94` | Delete every `?? existing…` merge; route through `contract.restore()`                                            | ~-30   | 3.3, 3.4 | `rg -n "\?\? existing" src/mcp/tools/` returns no hits. **`resolvePreservedGateYamlFields` at `gate-file-writer.ts:84` is NOT touched** | The writer's on-disk preservation is a different, correct live read. Deleting it alongside the merges would be the opposite error |
| 3.6 | ✓   | `gate-lifecycle-processor.ts:113`, `framework-lifecycle-processor.ts:158`       | Swap `saveVersion(beforeState)` for `recordEditResult(prior, produced)` using the new projections                | ~40    | 3.3, 3.4 | Task 0.3 goes GREEN — newest version equals `inspect`                                                                                   | F1. The bridge row handles the era transition with no data migration                                                              |
| 3.7 | ✓   | all three `*VersioningProcessor` handler signatures                             | Replace `args: any` with the typed input already declared in each `core/types.ts`                                | ~35    | 3.2-3.4  | `npx eslint <5 files>` shows no NEW violations against a freshly measured per-rule actual                                               | Step 2's `contracts` pre-flight failure: a contract crossing an `any` boundary is unenforced exactly where it matters             |

**Tier 3 gate**: `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci`. Per-rule ESLint diff against a freshly measured actual — the ratchet baseline is a ceiling and can absorb a new violation inside a net-negative diff.

### Tier 4 — Item D: preview any mutation

| #   | St  | File                                                                              | Change                                                                                         | ~Lines | Depends  | Verify                                                                                              | Justification                                                                             |
| --- | --- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ | -------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 4.1 | ✓   | three `*VersioningProcessor` rollback handlers                                    | Honour `dry_run`: render restored state + diff, return before `commitEdit`                     | ~70    | 3.5      | New test: `dry_run` rollback leaves file mtime and row-count unchanged                              | F8. The operator currently cannot see what a rollback produces before committing it       |
| 4.2 | ✓   | `gate-lifecycle-processor.ts`, `framework-lifecycle-processor.ts` delete handlers | Honour `dry_run` on delete: report what would be removed                                       | ~40    | 1.3      | `dry_run` delete leaves the directory present                                                       | F8                                                                                        |
| 4.3 | ✓   | `tooling/contracts/resource-manager.json`                                         | Widen the `dry_run` description to cover rollback and delete; run `npm run generate:contracts` | ~6     | 4.1, 4.2 | `npm run validate:contracts`; `git diff --name-only \| grep _generated` shows only generator output | Narrowing within the union is not breaking, and a description change adds no union member |

**Tier 4 gate**: `npm run validate:contracts && npm run test:ci`.

### Tier 5 — Item E: snapshot the directory tree — **REJECTED 2026-08-17 (OQ-E1 ruled)**

**Not deferred — refuted on measurement.** Gates (25 dirs) and frameworks (8 dirs) have ZERO files
their writers do not already own, so a tree snapshot buys them nothing; prompts have `tools/` in 7
of 121 dirs. And a recursive walk of a prompt directory captures nested chain-step prompts, which
are separately versioned resources — a parent rollback would silently overwrite them (F16). F7 is
closed by disclosure instead: a rollback now reports the script tools it did not restore. Rows
below are kept as the record of what was rejected.

| #   | St  | File                                                                 | Change                                                                                                                  | ~Lines | Depends | Verify                                                                                     | Justification                                                                                                                                         |
| --- | --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------ | ------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.0 | ⊘   | —                                                                    | Main-thread ruling on OQ-E1 before any edit in this tier                                                                | ~0     | 4.3     | Ruling recorded in `implementation-notes.md` with rationale                                | Durable rows recorded as object projections outlive this change (verified 2026-08-17 · OQ-E1 ruled REJECTED, so no edit in this tier was ever made)   |
| 5.1 | ⊘   | `src/modules/versioning/tree-snapshot.ts` (NEW)                      | Recursive read of a resource directory to `{relativePath: contents}`, with an exclusion list and a 1 MB refusal ceiling | ~110   | 5.0     | Unit test on `resources/prompts/examples/create_framework/` (74,336 B, the corpus maximum) | Ceiling gives 13× headroom over the measured max (verified 2026-08-17 · refuted by F16 — a recursive walk captures nested chain-step prompts)         |
| 5.2 | ⊘   | `snapshot-contract.ts`                                               | Add a `format` discriminator so tree-era and object-era rows are told apart on read                                     | ~30    | 5.1     | Old-format fixture row still restores through the object path                              | Without a discriminator the two eras are indistinguishable (verified 2026-08-17 · no format discriminator needed once the tree format is not adopted) |
| 5.3 | ⊘   | the three contract implementations                                   | Project and restore through the tree walker; retain object restore per the OQ-E1 ruling                                 | ~90    | 5.2     | New test: delete a file under `tools/{id}/`, roll back, assert it is restored              | F7 (verified 2026-08-17 · F7 closed by disclosure instead; rollback now reports unrestored script tools)                                              |
| 5.4 | ⊘   | `.claude/rules/sqlite-persistence.md`, `docs/reference/mcp-tools.md` | Record the format discriminator, the ceiling, and the measured percentiles                                              | ~35    | 5.3     | Docs describe current state, no historical breadcrumbs                                     | Docs and code move in lockstep (verified 2026-08-17 · nothing to document — the discriminator and ceiling do not exist)                               |

**Tier 5 gate**: `npm run validate:all`; measure `state.db` size before and after 50 simulated edits of the largest prompt tree, record the delta against the projected 3.7 MB.

### Tier 6 — Item F: read another workspace's history — **IMPLEMENTED 2026-08-17 (operator override of OQ-F1)**

Ruled defer; the operator overrode that and directed both tiers into this PR. Shipped as
`source_workspace`, read-only, refused on every non-read action. This release is therefore a
breaking major.

| #   | St  | File                                                             | Change                                                                                            | ~Lines | Depends | Verify                                                                     | Justification                                                                        |
| --- | --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------ | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 6.0 | ✓   | —                                                                | Main-thread ruling on OQ-F1 before any edit                                                       | ~0     | 5.4     | Ruling recorded                                                            | Adding a parameter widens the reachable-shape union                                  |
| 6.1 | ✓   | `version-history-service.ts:207, 249, 423`                       | Accept an optional read-scope override on `loadHistory`, `getVersion`, `compareVersions` **only** | ~40    | 6.0     | Two workspaces seeded; `history` with an override returns the other's rows | Reading another workspace's history is legitimate debugging; writing into one is not |
| 6.2 | ✓   | `router.ts:190-345`                                              | Pass the override for `history` and `compare`; reject it on `rollback` with a message naming why  | ~25    | 6.1     | `rollback` + override returns an error and writes nothing                  | A snapshot from another workspace describes a file that may not exist here           |
| 6.3 | ✓   | `tooling/contracts/resource-manager.json` + `generate:contracts` | Document the parameter as read-only and scope-local-on-write                                      | ~10    | 6.2     | `npm run validate:contracts`                                               | Contracts are SSOT                                                                   |

**Tier 6 gate**: `npm run validate:all && npm run test:ci`, plus a live two-workspace drive over both transports.

### Tier 7 — Relocate `session cancel` to `prompt_engine` — **IMPLEMENTED 2026-08-17 (operator override of OQ-G1)**

The session lifecycle is split across two tools and the split does not follow a rule. `prompt_engine`
creates sessions, advances them (`chain_id` + `user_response`), and already **abandons** one
(`force_restart`) — so it owns a session-lifecycle mutation today. `system_control session` owns
list, inspect, cancel, clear.

The rule that sorts these is **which id the caller holds**: a `chain_id` held because you are
running the chain is `prompt_engine`'s vocabulary, and stopping the run you are in is part of
running it. A `session_id` obtained from a listing is operator work across runs you are not in.
Under that rule `cancel` is misplaced and `clear`/`list`/`inspect` are correctly placed.

Secondary effect: `force_restart` is arguably a workaround for the missing cancel — "abandon this
run and start over" is cancel-then-start. Relocating `cancel` makes it possible to state the
relationship instead of having two overlapping abandonment verbs.

| #   | St  | File                                                              | Change                                                                         | ~Lines | Depends | Verify                                                          | Justification                                                                                    |
| --- | --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------ | ------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 7.0 | ✓   | —                                                                 | Main-thread ruling on OQ-G1 before any edit                                    | ~0     | 6.3     | Ruling recorded                                                 | Removing a `system_control` operation and adding a `prompt_engine` one changes two union members |
| 7.1 | ✓   | `prompt-engine.schema.ts`, `tooling/contracts/prompt-engine.json` | Add a cancel verb keyed on `chain_id`; `npm run generate:contracts`            | ~45    | 7.0     | `npm run validate:contracts`; `verify:mcp` lists the new shape  | The caller mid-chain already holds `chain_id`                                                    |
| 7.2 | ✓   | `prompt-executor.ts` / `chain-session-router.ts`                  | Route it to `cancelChain` with the request scope, reusing the DEV-T1-4 posture | ~40    | 7.1     | Cancel mid-chain, then resume → refused as cancelled            | Same store, same scope enforcement                                                               |
| 7.3 | ✓   | `session-action-handler.ts`, `system-control` contract            | Remove the `cancel` operation; `clear`/`list`/`inspect` stay                   | ~-45   | 7.2     | `rg "cancelSession" src/` returns no hits outside prompt-engine | Leaving both is the parallel system this repo bans                                               |
| 7.4 | ✓   | `docs/reference/mcp-tools.md`, `CHANGELOG.md`                     | Document the move and state the id-holding rule that decides it                | ~30    | 7.3     | Docs describe current state only                                | The rule is what stops the split re-forming                                                      |
| 7.5 | ✓   | `force_restart` description                                       | State its relationship to cancel now that both are on one tool                 | ~8     | 7.4     | Description names the distinction                               | Two abandonment verbs on one tool need one sentence separating them                              |

**Tier 7 gate**: `npm run validate:all`, plus a live drive — start a chain, cancel it through
`prompt_engine`, confirm resume is refused, on both transports.

## New file justifications

- **`src/modules/versioning/snapshot-contract.ts`** — the interface must be importable by three tool
  directories AND by `cli-shared`. Putting it in any one processor makes the other three import
  across a layer boundary, which `validate:arch` expresses as paths and would flag. It holds one
  interface, one result type, one registry.
- **`gate-manager/services/gate-snapshot-contract.ts`** and
  **`framework-manager/services/framework-snapshot-contract.ts`** — placed beside their processors
  because `validation.ts:590` records that `src/mcp/tools/` must not value-import
  `modules/prompts/prompt-schema`; the same constraint runs the other way. Folding them into the
  versioning processors would leave those files holding both a contract declaration and request
  orchestration, which is what Tier 3 exists to separate.
- **`src/modules/versioning/tree-snapshot.ts`** — a filesystem walker with a size ceiling has no
  domain knowledge and no state, so it is a module of pure functions. It cannot live in
  `snapshot-contract.ts` without making that file both a declaration and an I/O layer.
- **`tests/integration/mcp-tools/gate-framework-versioning.integration.test.ts`** — the existing
  workflow test covers the prompt write path at 537-773 and gate/framework only at the service
  level (263, 384, 784). Extending it would grow an 807-line file while mixing two coverage claims
  that must fail independently.

## Execution dispatch

| Work                                                                                             | Executor                                    | Why                                                                           |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------- |
| Tier 0 — write failing tests                                                                     | main thread                                 | Deciding what a correct restore looks like is the judgment this plan rests on |
| Tier 1.3, 1.6 — mechanical removals                                                              | bounded; delegate only if the operator asks | Fully determined once 1.1's probe lands                                       |
| Tier 1.1, 1.2, 1.4, 1.5                                                                          | main thread                                 | Transport parity for annotations is a correctness question                    |
| Tier 2 — ordering split                                                                          | main thread                                 | Touches the safety property; a wrong ordering is silent                       |
| Tier 3 — snapshot contracts                                                                      | main thread                                 | Which fields are authored versus resolved is domain judgment                  |
| Tier 4 — `dry_run`                                                                               | bounded once 3.5 lands                      | The restore result already exists; this renders it                            |
| Tier 5, 6                                                                                        | main thread, after the rulings              | Both blocked on judgment calls                                                |
| **Gate verdicts, tier acceptance, open-question rulings, the final live drive, the scope check** | **never delegate — main thread**            | —                                                                             |

**Final Verify**: `npm run build && npm run verify:mcp`, then a live drive of the real client flow —
create a gate, update twice, `history`, `dry_run` rollback, real rollback, `reload`, `inspect` —
over STDIO and Streamable HTTP. Green gates alone do not prove the path runs; a prior build passed
11/11 surface checks while a new action was structurally dead.

## Open Questions

### OQ-E1 — status: **RULED 2026-08-17 — REJECTED**, none of the three options below; see implementation notes (F16 + the measurement)

Durable `version_history` rows recorded as parsed-object projections survive item E indefinitely,
because a `SCHEMA_VERSION` bump restores that table rather than dropping it. A tree-based restore
path cannot read them. Replacing the object path outright silently makes every pre-E version
unrestorable, on a confirm-gated action operators read as "restore what version N had."

The bridge mechanism does not rescue this: `latestSnapshotMatches` compares `JSON.stringify`
equality, so an object-era row will never match a tree projection and every first post-E edit
bridges — correct and harmless, but it protects going _forward_ only and does nothing for reaching
_backward_.

- **Default**: retain the object restore path behind the Tier 5.2 format discriminator, with a
  stated retirement condition — deleted once no object-era row remains within `max_versions` reach
  for any resource, measurable by querying the discriminator.
- **Alternative (a)**: declare pre-E versions non-restorable and say so in the history output.
  Honest, but removes reachability operators currently have.
- **Alternative (b)**: one-time re-projection of existing rows from current disk state at the bump.
  **Wrong** — it would record today's bytes under an old version number, making every historical row
  a lie.
- **Note**: the default is a dual-read path, which cleanup-standards prices as debt. Accepted only
  because it carries a measurable retirement condition and a query that detects it.

### OQ-F1 — status: **OVERRIDDEN 2026-08-17 — implement now** (operator decision; the defer ruling below is kept as the reasoning it replaced)

Adding a read-scope parameter widens the reachable-shape union, which this repo's Public API
Contract prices as breaking. Is the debugging value worth a major bump?

- **Default**: defer Tier 6 until a major version is otherwise warranted. The reasoning that settled
  `version_description` by deletion applies to speculative additions.
- **Alternative**: ship it in the next major alongside the `gate_verdict` string-branch retirement,
  which already requires one.

### OQ-A1 — status: **RESOLVED by probe at task 1.1**

Do the three handlers have entry points other than the `resource_manager` router?

- **Default**: if any does, keep `assertConfirmed` at both levels and record why.
- **Alternative**: route the second entry point through the router.

### OQ-G1 — status: **OVERRIDDEN 2026-08-17 — implement now** (operator decision; the defer ruling below is kept as the reasoning it replaced)

Relocating `cancel` removes a member from `system_control`'s reachable-shape union and adds one to
`prompt_engine`'s. Both halves are breaking under this repo's Public API Contract, so the move
needs a major version.

- **Default**: ship it in the next major alongside the `gate_verdict` string-branch retirement and
  any OQ-F1 outcome, so one major absorbs every union change rather than three majors carrying one
  each.
- **Alternative**: add `cancel` to `prompt_engine` now and deprecate the `system_control` operation
  in place, retiring it a release later. Costs a period where both exist — the parallel system
  cleanup-standards prices as debt — but avoids blocking the ergonomic fix on a major.
- **Not an option**: adding it to `prompt_engine` and leaving `system_control`'s indefinitely. A
  duplicate with no retirement condition is the shape this plan exists to remove.

### OQ-C1 — status: **RULED 2026-08-17** — default adopted, derived from the writer rather than restated

Which gate and framework fields are authored versus resolved through the category/global chain?
Prompts have a worked answer in `SNAPSHOT_FIELDS_LEFT_TO_THE_WRITER`; gates and frameworks have
never had the question asked.

- **Default**: treat every key in `PRESERVED_GATE_YAML_KEYS` (`gate-file-writer.ts:67`) as resolved
  and leave it to the writer, projecting everything else.
- **Alternative**: project the full YAML and let Tier 5's tree snapshot make the distinction moot,
  which argues for doing E before C — rejected because it leaves the live defects unfixed longer.

## Testing strategy

| What to test                                                   | Test type                        | Location                                                                    | Why this type                                                                                                                     |
| -------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Gate/framework rollback restores the recorded snapshot exactly | integration, real write path     | `tests/integration/mcp-tools/gate-framework-versioning.integration.test.ts` | The defect lives in the processor + file writer + registry reload seam; a unit test over the service alone is what let F2 survive |
| A refused rollback writes no version rows                      | integration, row-count assertion | same file                                                                   | The claim is about persistence side effects, so it must be measured against the table, not inferred from a return value           |
| Go-forward numbering on gate and framework                     | integration                      | `tests/integration/versioning/version-history-workflow.test.ts`             | Extends the file that already owns the semantics claim for prompts                                                                |
| `assertConfirmed` denies every registered action               | unit                             | `tests/unit/mcp-tools/resource-manager/`                                    | Pure function over an action name; an integration test would add setup without adding signal                                      |
| Tool annotations survive re-registration                       | e2e, both transports             | `tests/e2e/conformance/`                                                    | STDIO pins one server, HTTP builds one per request; only a transport-crossing test can see the difference                         |
| `dry_run` writes neither file nor row                          | integration                      | `gate-framework-versioning.integration.test.ts`                             | Two side-effect surfaces must both be asserted absent                                                                             |

**Every new assertion carries two obligations**: a `reload` between write and read-back, and a
recorded red-on-mutation-removal. `workspace-and-mutations.yaml:24-29` documents a row that asserted
a rollback result and passed while the rollback never ran, because the stale registry served the
expected content either way. Removing `confirm: true` did not red it.

## Done criteria

| Criterion              | Validation                                                                                        | Pass condition                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 closed              | Task 0.3                                                                                          | Newest gate and framework version equals what `inspect` returns, on all three types                                                                                          |
| F2 closed              | Task 0.1                                                                                          | `rg -n "\?\? existing" src/mcp/tools/` returns no hits AND restore-fidelity assertions are green                                                                             |
| F3 closed              | Task 0.2                                                                                          | `COUNT(*) FROM version_history` unchanged across a refused rollback on all three types                                                                                       |
| F4 closed              | Tier 1 unit test                                                                                  | `rg -n "!confirm\|confirm !== true" src/mcp/tools/` returns no hits; every registered action refuses without `confirm`                                                       |
| F5 closed              | `npm run verify:mcp` + tool list read-back                                                        | Annotations present on all three tools over STDIO **and** Streamable HTTP                                                                                                    |
| F6 closed              | `rg -n "version_description" src/`                                                                | No hits; contracts unchanged                                                                                                                                                 |
| F7 closed              | OQ-E1 ruling + rollback output                                                                    | A prompt rollback names the script tools it did not restore, rather than implying it restored them                                                                           |
| F8 closed              | Task 4.1                                                                                          | `dry_run` rollback leaves file mtime and row-count unchanged                                                                                                                 |
| F9 closed              | `rg "\.history\.json" tests/`                                                                     | No hits                                                                                                                                                                      |
| F10 closed             | Task 0.5                                                                                          | Four red-on-mutation-removal outputs recorded in implementation-notes.md                                                                                                     |
| Writers agree          | `npx jest tests/unit/cli-shared/version-history.test.ts`                                          | CLI and service produce identical numbering for the same edit sequence                                                                                                       |
| Safety property intact | Fault-injection test — `gate-framework-versioning.integration.test.ts` "safety property"          | A persistence failure during `commitEdit` leaves the file unmodified. Shown red 2026-08-17 by moving the write above the record on both the update and rollback paths        |
| Full suite             | `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci` | Green, with a per-rule ESLint diff against a freshly measured actual                                                                                                         |
| Live drive             | `npm run build && npm run verify:mcp`, then the real client flow                                  | Driven 2026-08-17 against a gate registered at startup — F17 blocks the `create`-first form, tracked in `plans/techincal_debt/gate-registry-refresh-on-create-2026-08-17.md` |

## Documentation

| Doc                           | Update needed                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `docs/reference/mcp-tools.md` | Version semantics are now uniform; document `dry_run` on rollback and delete, and the tool annotations |
| `docs/guides/gates.md`        | Gate versioning now records the produced state; correct any statement implying otherwise               |
| `CHANGELOG.md`                | `[Unreleased]` → Fixed, per the entry below                                                            |
| `CLAUDE.md`                   | No change — the Public API Contract section already covers the union rule this plan follows            |

## Release

- **commit_convention**: `fix(mcp-tools): <description>` for Tiers 1-4; `refactor(versioning): <description>` for Tier 5
- **scope**: `mcp-tools`, `versioning` is not a declared scope — use `mcp-tools` for processor and router work, `runtime` for `modules/versioning`, `tests` for Tier 0
- One commit per tier; Tier 0 lands its failing tests skipped or in a branch that is not pushed to `main` green, so the red state is recorded in implementation-notes rather than in CI

## Growth capture

**Not run here — promoted out.** Phase 4c is owed on this initiative and belongs in a
`/knowledge-capture` pass against the whole PR, not in a plan being retired. Carried forward:

- Pattern: _an explicit allowlist silently drops a parameter that typechecks at every layer._ Three
  sightings inside this one initiative — `version_description`, `dry_run` on two router routes, and
  `cancel`. Past the 3-sighting bar, so this one is ready to codify rather than record.
- Pattern: _an assertion that cannot fail because the fixture sits inside the bound it asserts._ Two
  sightings — the F18 bridge-row test, whose fixture had no optional field so both key orderings
  coincided, and the conformance row at `workspace-and-mutations.yaml:24-29`.
- Pattern: _a shared tool surface can hide divergent semantics per resource type._ The tool contract
  was uniform while three implementations disagreed. First sighting; record, do not codify.
- Pattern: _a projection-based snapshot creates a resolved-versus-authored problem a byte-based one
  does not have._ First sighting.
- Memory: the durable-table constraint means every snapshot-format change needs a dual-read plan,
  not a migration.
- Skill: `/testing` may deserve the red-on-mutation-removal obligation as an explicit step. This
  initiative caught two assertions that passed without their mutation ever running, and the same
  discipline is what turned the safety-property test from a rubber stamp into evidence.

## Risks carried forward

- `src/mcp/tools/index.ts` measures 1,217 lines, past the threshold at which size escalates when it
  co-occurs with another signal. Tier 1 adds ~25 lines. Decomposition is separate work, named here
  so it is not discovered as a surprise.
- The ESLint ratchet is a ceiling rather than a measurement, so Tier 3's gate diffs per-rule against
  a freshly measured actual instead of trusting a green run.
- Every tier touching the versioning service carries a paired edit in
  `src/cli-shared/version-history.ts`. Two writers against one durable table diverge silently when
  only one moves.

## Changelog entry

**Fixed** — Gate and framework version history now records the state each edit produced, matching
prompts, and rollback restores the recorded snapshot exactly instead of merging current values into
it. A rollback refused for any reason no longer writes version rows. `cpm rollback` merges the
recorded snapshot into the existing file rather than replacing it, so rolling back a gate no longer
deletes `pass_criteria`, `retry_config` and `activation`; fields the snapshot cannot restore are
reported instead of dropped. A framework's `description` is written to disk again. Two consecutive
edits record one row each rather than a spurious bridge row per edit.

**Added** — `dry_run` previews rollback and delete on all three resource types. `source_workspace`
reads another workspace's version history on `history` and `compare`, and is refused on every
action that writes.

**Changed (BREAKING)** — Destructive actions are denied by one guard ahead of dispatch, and
`confirm` is now enforced on `prompt delete` as its schema text always claimed. Tools advertise
destructive hints to clients. `cancel` moved from `system_control session` to
`prompt_engine(chain_id, cancel: true)`: the id you hold decides the tool, and a `chain_id` is held
because you are running the chain. `version_description` was removed — it was declared and read but
no caller could reach it.
