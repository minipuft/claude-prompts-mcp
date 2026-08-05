---
title: "SQLite Persistence Layer — Boundaries, Validation, and Remediation"
date: 2026-08-03
status: active
tags: [persistence, sqlite, validation-gates, technical-debt]
---

# SQLite Persistence Layer — Boundaries, Validation, and Remediation

Replaces the former `state-db-redundancy-cleanup.md`, deleted 2026-08-03. Its two surviving items
are folded in under _Carried forward from the superseded plan_; the rest were already done or are
owned by the execution-ledger initiative.

**Deliverable order is deliberate**: define and _enforce_ the boundaries first, remediate second.
Patching eleven findings without a contract fixes symptoms and reproduces the drift on the next
consumer.

---

## Phase 1 — Discovery & Triage

### Measured state (live `state.db`, SCHEMA_VERSION 16, read-only probe 2026-08-03)

Three SQLite files, four independent access paths:

| File                                 | Owner                                             | Contents                                                                     |
| ------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `state.db` (1.1 MB + **4.2 MB WAL**) | `SqliteEngine`                                    | 10 tables + 1 view                                                           |
| `hooks-state.db` (45 KB)             | `hooks/lib/hook_state_store.py`                   | `chain_session_state`, `ralph_session_state`                                 |
| `verify-state.db`                    | `engine/gates/shell/verify-active-state-store.ts` | own `DatabaseSync`, own schema — **file does not exist; path never written** |

Fourth path: `cli-shared/version-history.ts` reaches `state.db` by `spawnSync`-ing **python3 with
an embedded sqlite3 script**, from a Node process that already has `node:sqlite`.

### Table → writer → reader map

| Table                       | Rows              | Writer                                                      | Reader                        | Scope column holds                  |
| --------------------------- | ----------------- | ----------------------------------------------------------- | ----------------------------- | ----------------------------------- |
| `kv_state[framework]`       | 10                | FrameworkStateStore                                         | same                          | **real workspace ids** ✅           |
| `kv_state[gates]`           | 1                 | GateStateStore                                              | same                          | `'default'` only                    |
| `kv_state[arg_history]`     | 1 (55 KB)         | ArgumentHistoryTracker — **raw SQL, hardcoded `'default'`** | same                          | none                                |
| `kv_state[resource_hashes]` | 1                 | ResourceChangeTracker                                       | same                          | `'default'`                         |
| `resource_index`            | 133               | ResourceIndexer                                             | indexer + `prompt-suggest.py` | n/a ✅                              |
| `resource_changes`          | **1000 (at cap)** | raw SQL `'default'`                                         | tracker                       | none                                |
| `version_history`           | 3                 | spawned Python                                              | same                          | hardcoded `'default'`               |
| `chain_run_registry`        | 0                 | DirectChainRunRegistry                                      | manager + hooks               | **server PID**                      |
| `chain_sessions`            | 0                 | `projectToHookView`                                         | hooks, the view               | **server PID**                      |
| `execution_records`         | **52**            | pipeline stages 18 & 21                                     | **nobody**                    | `'default'`; ws/org **always NULL** |
| `skills_sync_manifests`     | 0                 | skills-sync service                                         | service + MCP tool            | client/scope ✅                     |
| `tenants`                   | 1                 | DDL seed                                                    | **nobody** (tests only)       | —                                   |

### Findings

**F1 — The execution ledger is write-only.** `execution_records` holds 52 rows.
`queryBySession()` and `queryByChain()` have **zero callers** across `src/`, `hooks/`, `cli/`. The
one documented consumer, `v_execution_status`, selects `FROM chain_sessions` and reaches the ledger
only through correlated subqueries scoped to _live_ rows — and `chain_sessions` is `DELETE`d per-PID
at cleanup. The view returns 0 rows while 52 durable records sit unreachable. SEP-1686 landed the
writer half; the read half never arrived. 30 of 52 are stuck at `working` with no terminal transition.

**F2 — `execution_records.workspace_id` / `organization_id` are structurally unwritable.**
`execution-context.ts:234`:

```ts
getScopeOptions(): StateStoreOptions | undefined {
  const scopeId = this.state.identity.continuityScopeId;
  return scopeId && scopeId !== 'default' ? { continuityScopeId: scopeId } : undefined;
}
```

It never emits `workspaceId`/`organizationId`, but `buildAppendParams` reads exactly those two
fields. 52/52 rows NULL — by construction, not by accident.

**F3 — `tenant_id` carries three incompatible meanings in one database.** Server **PID**
(`chain_sessions`, `chain_run_registry` — hooks run `process.kill(pid,0)` liveness on it) ·
**workspace id** (`kv_state`) · literal **`'default'`** (`execution_records`, `version_history`,
`resource_changes`). `v_execution_status` publishes a PID under the same column name
`execution_records` uses for a workspace.

**F4 — `SqliteEngine.shutdown()` is never called.** `application.ts:570` shuts down nine
subsystems; the database is not among them. `db.close()` never runs, so WAL never checkpoints —
4.2 MB of WAL against a 1.1 MB database.

**F5 — Migration code in a schema documented as having none.** `applyIdentityScopeMigration()`
runs unconditionally every startup — 5 PRAGMAs, up to 10 UPDATEs, 8 CREATE INDEXes — right after
`applySchema()` already created those columns. It is a **treadmill**: `resource_changes` shows 993
rows backfilled to `'default'` and 7 NULL, because the raw-SQL writer never sets `workspace_id` and
the next startup backfills what the writer keeps leaving empty.

**F6 — `version_history` DDL declared twice with divergent shapes.** Engine schema includes
`organization_id`/`workspace_id`; the embedded Python `ensure_schema` omits both.

**F7 — Database failures are log-and-swallowed at four wiring sites.**
`module-initializer.ts:127, 221, 270` and `application.ts`. Per `architecture.md`, persistence must
throw. Today the server reports a clean start with no persistence, and framework/gate state falls
back to defaults.

**F8 — No retention on `execution_records`.** `resource_changes` trims at 1000 (currently _exactly_
at cap — actively evicting). `arg_history` caps 50 entries per chain but chains are unbounded.
`execution_records` has no `DELETE` anywhere. `state.db` is shared across every project on the machine.

**F9 — Workspace isolation is claimed generally, delivered once.** Only `kv_state[framework]` is
genuinely scoped (10 distinct workspaces). Gates, arg-history, version-history, and resource-changes
all collapse to `'default'` — gate enable/disable and argument history are global across every
project sharing the file.

**F10 — `tenants` is a dead table**, kept alive solely by tests that insert into it to prove it works.

**F11 — `SCHEMA_VERSION` bump silently destroys user data.** _(Found during Phase-2 pre-flight, not
in the original audit.)_ `dropAllTables()` drops _every_ table. `version_history` holds real user
resource snapshots backing the rollback feature; `skills_sync_manifests` records which files were
exported where. CLAUDE.md justifies drop-and-recreate with "all indexed data is regenerated from
YAML on startup" — true of `resource_index`, **false** of `version_history`, whose purpose is
holding snapshots that no longer exist in YAML. The bump to 16 already ran this.

### Healthy — do not break

`StateStore`/`DatabasePort` abstraction · the 4-tables-into-`kv_state` consolidation ·
`ResourceIndexer` (133 resources, the one genuinely well-integrated cross-language surface) ·
17 DB test files.

### Blind-spot vocabulary

The terms an expert in embedded-SQLite state layers would use that were absent from this codebase's
discussion — each maps to findings:

| Term                             | What it names                                                  | Bites at |
| -------------------------------- | -------------------------------------------------------------- | -------- |
| **Single-writer discipline**     | Exactly one module owns writes to a table                      | F5, F9   |
| **Scope-column contract**        | A scope column is populated by every writer, or exists on none | F2, F5   |
| **Column trisemy**               | One column name carrying different semantics per table         | F3       |
| **Projection vs ledger**         | Derived live-only state vs append-only durable history         | F1       |
| **Retention as schema property** | Every append-only table declares max rows/age at creation      | F8       |
| **Checkpoint discipline**        | WAL requires an explicit close/checkpoint owner                | F4       |
| **Ephemeral-vs-durable posture** | Drop-and-recreate and ALTER-migration are mutually exclusive   | F5, F11  |
| **Phantom column**               | Declared + indexed, structurally unwritable                    | F2       |

**Reframing this yields**: _for each table declare single writer, scope semantics, durability
posture, and retention — then make each declaration mechanically checkable._ That turns eleven
scattered findings into one table with four columns.

### Intent

- **work_type**: refactor · **secondary**: feature (validation gates + guidance capture)
- **risk**: high — F3 touches the Python hook contract, declared public API in CLAUDE.md;
  F4/F7 touch startup and shutdown; F11 is active data loss
- **external_deps**: none — `node:sqlite` is a builtin

---

## Phase 2 — Design & Pre-flight

### Pre-flight result

| Check                 | Result   | Probe evidence                                                                             |
| --------------------- | -------- | ------------------------------------------------------------------------------------------ |
| domain                | pass     | DDL exclusively in `sqlite-engine.ts` except the `version_history` duplicate               |
| layer                 | pass     | registry is declaration data; no logic                                                     |
| naming                | pass     | `TABLE_CONTRACTS` / `table-contracts.ts` — states what it holds                            |
| complexity            | pass     | no function over cognitive 15 introduced                                                   |
| size                  | pass*    | `sqlite-engine.ts` 587, `resource-indexer.ts` 982 — under 1000                             |
| service               | **FAIL** | `rg "class.*(Retention\|Cleanup\|Pruner\|Vacuum)"` → zero hits; trimming is inlined ad-hoc |
| defined               | pass     | `ls .claude/rules/` → only extension-alignment.md, mcp-contracts.md                        |
| contracts             | **FAIL** | F2 (DDL declares columns no writer populates), F6 (two divergent DDLs)                     |
| pattern               | pass     | OOP shell + FP internals holds                                                             |
| reuse-scope           | pass     | gates reuse `scripts/` + `validate:all`                                                    |
| persistence           | **FAIL** | F7 log-and-swallow ×4; F4 no shutdown owner                                                |
| lib-api / lib-version | pass     | `DatabaseSync` surface verified in live use; Node ≥22.13 floor matches                     |

**failures: 3** → compound: **persistence + contracts = INTERFACE CONTRACT VIOLATION**.
Per `refactoring.md`: _fix the contract, not the symptoms._ This is the plan's structure — declare
`TABLE_CONTRACTS` first, then every remediation becomes a consumer conforming to a stated contract.

### Interfaces

```ts
// infra/database/table-contracts.ts — SSOT consumed by gates AND applySchema()
type Posture = "derived" | "ephemeral" | "durable";
type ScopeKind = "none" | "workspace" | "run-owner-pid" | "client-scope";

interface TableContract {
  table: string;
  owner: string; // module path with exclusive write authority
  posture: Posture; // drives dropAllTables() eligibility
  scope: ScopeKind; // what identity columns mean HERE
  retention:
    { maxRows: number } | { maxAgeDays: number } | "unbounded-justified";
  rebuiltFrom?: string; // required when posture !== 'durable'
  readers: string[]; // [] is a FINDING, not a default — this is F1's detector
}
export const TABLE_CONTRACTS: readonly TableContract[];
```

Gates (in `scripts/`, each with `--self-test`, each wired into `validate:all`):

1. **`validate:table-contracts`** — `set(applySchema DDL) === set(TABLE_CONTRACTS)`; flags
   undeclared tables, dead declarations, `readers: []`, duplicate DDL outside the owner, and
   INSERT/UPDATE/DELETE on a contracted table outside its owner → F1, F5, F6, F9, F10
2. **`validate:no-phantom-columns`** — every DDL column appears in ≥1 INSERT/UPDATE column list in
   the owner module → F2

### Key decisions

| Decision         | Chosen                                                    | Rejected                          | Why                                                                                                                         |
| ---------------- | --------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Contract medium  | Executable TS const read by gates + runtime assert        | Markdown boundary doc             | Docs do not fail CI; their absence produced all eleven findings                                                             |
| Posture taxonomy | 3 values (derived/ephemeral/durable)                      | Binary ephemeral/persistent       | Binary is what caused F11 — `resource_index` and `version_history` are both "not ephemeral" yet need opposite handling      |
| F3 mechanism     | Add `run_owner_pid`; keep writing `tenant_id` one release | Rename `tenant_id`→`workspace_id` | `db_reader.py` reads `tenant_id` for PID liveness; the Python hook contract is public API — additive may avoid a major bump |
| F5 timing        | Delete the migration **after** writers conform            | Delete now                        | Deleting first freezes the 7 NULL rows permanently; the writer is upstream                                                  |
| Retention        | Declared per-table, one enforcement pass                  | Per-consumer inline trimming      | Status quo is measurably inconsistent                                                                                       |
| Guidance split   | Portable model → `/sqlite` skill; repo map → project rule | All in CLAUDE.md                  | An 11-row map fails the eviction test — reference, not always-load enforcement                                              |

---

## Phase 2.5 — Path Verification

All 13 cited paths verified with literal `ls`/`wc -l`/`rg`. **Zero shims, zero major drift.**
Symbol lines landed exactly for `sqlite-engine.ts` (41/228/258/273/479), `execution-context.ts:234`,
and `execution-record-store.ts:163`; `manager.ts` `projectToHookView` at 351 and
`module-initializer.ts` sites at 216/255 were within ±5 of the cited ranges.

**Five corrections carried into Phase 3:**

1. **F7 has FOUR swallow sites, not three** — `module-initializer.ts:127` (ResourceChangeTracker)
   was missed by the original audit.
2. **Self-test precedent count is 14**, not 12 (`rg -o -- '--self-test' package.json | wc -l`).
3. **`verify-state.db` ENOENT** against a confirmed source path at
   `verify-active-state-store.ts:55` — the fourth access path is **code-only and has never
   executed a write**. Reclassifies Tier 6 from "consolidate a live store" to "remove an
   unexercised path".
4. **Size escalation**: `manager.ts` 2054 ln and `application.ts` 1311 ln both exceed the >1000
   Critical threshold. This plan touches both and must add no net lines.
5. **Positive confirmation of F4**: `rg 'private async shutdown|SqliteEngine' application.ts`
   returns 570 (shutdown) and 779 (hot-reload resync) as disjoint hits — no `SqliteEngine`
   reference inside the shutdown block.

---

## Phase 3 — Implementation Plan

### Tier 0 ✅ COMPLETE 2026-08-03 — Stop active data loss (F11).

| #   | Status | File                                                | Change                                                                                                                                                                                                  | Depends | Verify                                                               |
| --- | ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------- |
| 0.1 | ✓      | `sqlite-engine.ts` `ensureSchema`/`dropAllTables`   | Snapshot durable rows → drop → recreate → restore by column intersection. **Deviation D1** — a plain "skip durable tables" freezes their DDL, because `applySchema()` uses `CREATE TABLE IF NOT EXISTS` | none    | 6 integration tests; falsified by emptying `DURABLE_TABLES` → 3 fail |
| 0.2 | ✓      | `sqlite-engine.ts:14-29` header                     | Replaced the "state.db is ephemeral" claim; names both durable tables and why each is unrecoverable                                                                                                     | 0.1     | Read                                                                 |
| 0.3 | ✓      | `tests/integration/database/sqlite-backend.test.ts` | `describe('Schema version bump')` — durable survival, derived discard, AUTOINCREMENT re-seed                                                                                                            | 0.1     | `npm run test:integration` — 449 pass                                |

**Gate**: ✅ `npm run typecheck && npm run test:integration` — plus `lint:ratchet`, `typecheck:tests:ratchet`, `test:ci` (1901 pass).

### Tier 1 ✅ COMPLETE 2026-08-03 — The contract + enforcement. INERT: no runtime behavior change.

| #    | Status | File                                                             | Change                                                                                                                                                | Depends  | Verify                                                            |
| ---- | ------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| 1.1  | ✓      | **NEW** `src/infra/database/table-contracts.ts`                  | `TableContract` + `TABLE_CONTRACTS` for **10 tables** (not 11 — see R1) + `VIEW_CONTRACTS`. Adds `AcceptedException` with a mandatory `closedBy`      | T0       | `npm run typecheck`                                               |
| 1.2  | ✓      | `sqlite-engine.ts` `assertSchemaMatchesContracts`                | Startup assert on tables _and_ views; excludes `sqlite_sequence` via `SQLITE_INTERNAL_TABLES`. `DURABLE_TABLES` now derives from `posture: 'durable'` | 1.1      | `npm run verify:mcp` — 11/11, server still boots                  |
| 1.3  | ✓      | **NEW** `scripts/validate-table-contracts.ts` + `--self-test`    | Set-equality, posture coherence, reader/owner path existence, single-writer, exception hygiene                                                        | 1.1      | Self-test OK; found 9 real foreign-writer sites                   |
| 1.4  | ✓      | **NEW** `scripts/validate-no-phantom-columns.ts` + `--self-test` | Declared columns with no writer; exempts DEFAULT/AUTOINCREMENT                                                                                        | 1.1      | Self-test OK; found 8 true phantoms + 1 documented false positive |
| 1.4b | ✓      | **NEW** `scripts/table-contracts-reader.ts`                      | **Deviation D4** — shared DDL parser + SQL-site scanner both gates need                                                                               | 1.1      | Covered by both self-tests                                        |
| 1.5  | ✓      | `server/package.json`                                            | Both gates + both self-tests wired into `validate:all`                                                                                                | 1.3, 1.4 | See gate note                                                     |

**Gate**: ✅ every `validate:*` step passes **except three that were already failing before this
work** (`validate:format`, `validate:no-methodology-vocab`, `validate:documented-options` — none in
files these tiers touch; see implementation notes C2). Both new gates pass. `verify:mcp` 11/11,
`test:ci` 1901 pass, `test:integration` 449 pass.

**Gates written in TypeScript via `tsx`** (Deviation D3), matching `generate:contracts` /
`validate:frameworks`, so they import `TABLE_CONTRACTS` as a value instead of AST-parsing it.

### Tier 2 ✅ COMPLETE 2026-08-03 — Capture the boundaries as guidance.

| #   | Status | File                                              | Change                                                                                                                                                                                                                                                                                                                                                              | Depends | Verify                                                          |
| --- | ------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------- |
| 2.1 | ✓      | `~/.claude/skills/sqlite/SKILL.md` (329 → 434 ln) | New §Table Governance: four declared properties, posture taxonomy + the freeze-the-DDL trap, scope-column contract + trisemy, declaration-dead vs value-dead, single-writer ownership, retention, checkpoint ownership. **Deviation D6** — also _corrected_ §Schema Decision Tree, which asked the posture question per database; that framing is what produced F11 | T1      | Prettier OK; measured 434 ln / 4164 tok (skills are unbudgeted) |
| 2.2 | ✓      | **NEW** `.claude/rules/sqlite-persistence.md`     | 10-table map (**not 11** — R1), gates + their known blind spot, `tenant_id` trisemy, durable-table rules, four access paths, add-a-table checklist. Globs `**/infra/database/**`, `**/*-store.ts`, `**/*-registry.ts`, `**/*-indexer.ts`                                                                                                                            | 2.1     | 114 ln / 1410 tok — under the ≤150 ln rule ceiling              |
| 2.3 | ✓      | `CLAUDE.md` §Runtime State + pointer list         | Corrected **two** false claims, not one — "no migration code since `state.db` is ephemeral" is also falsified by Tier 0. **Deviation D7**                                                                                                                                                                                                                           | 2.2     | Prettier OK; +209 tok net (see C3)                              |
| 2.4 | —      | `plans/state-db-redundancy-cleanup.md`            | **Obsolete.** The file was deleted outright during the pre-Tier-0 cleanup (staged deletion, 347 ln). A superseded-marker cannot be applied to a deleted file, and deletion supersedes more completely than marking                                                                                                                                                  | none    | `git status` shows `D`                                          |

**Gate**: ⚠️ the plan's stated gate is unsound — see **R6**. `check-rules.sh` reads only
`~/.claude/CLAUDE.md` + `~/.claude/rules/*.md`, so it sees **neither** 2.1 (a skill) **nor** 2.2 (a
_project_ rule); and it already exits 1 on a pre-existing malformed `observations.jsonl:3`, which
short-circuits the `&&`. Substituted real checks: Prettier clean on all three files, forbidden-word
scan clean, and both files measured against their charter budgets.

### Tier 3 ✅ COMPLETE 2026-08-03 — Give the execution ledger a reader

**Operator decision**: keep the ledger. Chain execution history stays a feature, so F2 (scope
columns) and F8 (retention) remain required work in Tiers 4 and 6 rather than evaporating with a
deletion.

| #   | Status | File                                                                                        | Change                                                                                                                                          | Depends | Verify                                                                                                                                                                             |
| --- | ------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | ✓      | `execution-record-store.ts`                                                                 | `queryRecent(limit, scope)` — ULID DESC, clamped to `[1, 500]`. Arg order follows the `queryBySession(id, scope?)` sibling                      | T1      | 7 new tests; falsified — removing the clamp fails 2                                                                                                                                |
| 3.2 | ✓      | **NEW** `handlers/execution-history-action-handler.ts` + router, action ids, contract, docs | New `execution_history` action. Contract enum was also missing `changes`, which the router has always had — fixed alongside                     | 3.1     | `verify:mcp` 11/11 **plus** a live end-to-end probe (see R8 — verify:mcp alone passed a broken build)                                                                              |
| 3.3 | ✓      | `sqlite-engine.ts` (view at ~584, not 440)                                                  | `v_execution_history` reading `execution_records` directly. **Forced `SCHEMA_VERSION` 16 → 17 — Deviation D9**                                  | 3.1     | 4 view tests; SQL proven against the real 64 rows before the bump dropped them                                                                                                     |
| 3.4 | ✓      | pipeline catch + stage 21 (**not** stages 18/21 — **D8**)                                   | `failed` from the pipeline's single error boundary; `cancelled` from stage 21, which also makes `state.session.aborted` read for the first time | 3.1     | 11 tests: 5 pipeline (failure) + 6 stage-21 (abort). Falsified two ways — deleting the abort branch fails 3, inverting abort/complete precedence fails exactly the precedence test |

**Why 3.3 is not optional**: `v_execution_status` selects `FROM chain_sessions`, which is
PID-deleted at cleanup, so it structurally cannot see a completed run. Measured before the change:
the old view returned **0 rows against 64 live records**.

**Why 3.4 is not optional**: 35 of 64 rows were stuck at `working` (not 30 of 52 — see R7). A
history feature reading a ledger where 55% of entries never reach a terminal state reports garbage.

**Gate**: ✅ `verify:mcp` 11/11 · `test:integration` 460 pass · `test:ci` 1906 pass · typecheck
clean · both ratchets no regressions · both Tier 1 gates pass ("10 tables and **2 views**") ·
`validate:contracts` in sync · arch/filesize/metadata/documented-options/required-contexts all OK.

**Tier 0 was verified on live data by this tier.** The v17 bump ran against the real `state.db`:
`version_history` 3 → 3 preserved, `skills_sync_manifests` 0 → 0, `execution_records` 64 → 0
(declared `ephemeral`), `resource_index` rebuilt to 133. Before Tier 0 that bump would have
destroyed the rollback snapshots.

### Tier 4 — Conform writers, THEN retire the migration. Order is the fix (F9 → F5).

| #      | File                                  | Change                                                                           | ~Lines | Depends | Verify                                                                                                                                                                                              |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------- | ------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 ✅ | `execution-context.ts:234`            | Return `{continuityScopeId, workspaceId, organizationId}` — stop truncating      | ~10    | T1, T3  | ✅ `validate:no-phantom-columns` green — 8 accepted, down from 10                                                                                                                                   |
| 4.2 ✅ | `argument-history-tracker.ts:361,382` | Replace raw SQL with `SqliteStateStore(kv_state, key:'arg_history')`; pass scope | ~35    | 4.1     | ✅ Per-workspace isolation asserted in `argument-history-tracker.persistence.test.ts`; falsified by dropping the scope arg. Single-writer exception for this file removed from `table-contracts.ts` |

> **4.2's prescribed mechanism was not reachable as written.** The row says "use
> `SqliteStateStore`", but `SqliteStateStore` lives in `infra/` and **two** dependency-cruiser rules
> forbid naming it from where the tracker and its wiring live: `modules-no-infra-static` (static,
> dynamic, _and_ type-only) and `mcp-no-infra-static`. So neither `argument-history-tracker.ts`
> (Layer 3) nor `prompt-executor.ts` (Layer 4) may construct one.
>
> Shape actually used, which is what those rules' own comments prescribe: the tracker depends on
> the `StateStore<T>` **interface** from `shared/types`, and `runtime/module-initializer.ts` — the
> composition root, which is unconstrained — builds the concrete `SqliteStateStore` and threads it
> down through `McpToolRouter.setDatabasePort`. Scope is applied in `prompt-executor.ts`, which
> already owns the launch workspace from the 4.6 work.
> | 4.3 ✅ | `resource-change-tracker.ts:243` | Pass real scope instead of literal `'default'` | ~12 | 4.1 | ✅ Clean-boot probe: 119 rows, 0 NULL `workspace_id`, value `'server'` (derived, not the `'default'` sentinel). 3 integration tests, falsified twice |
> | 4.4 ✅ | `gate-state-store.ts:192,244` callers | Supply scope where none is passed | ~20 | 4.1 | ⚠️ **Stated verification substituted.** "`kv_state[key='gates']` gains >1 row" cannot distinguish broken code from nobody having toggled gates in a second workspace. Replaced with `gate-system-scope-propagation.test.ts`, which observes the scope argument at the seam; falsified per site |

> **4.4 was not where the plan said, and nearly got marked done on the wrong evidence.**
> `gate-action-handler.ts` already passed `this.requestScope` at all six of its call sites, which
> made the row look satisfied. The unscoped callers were in `LightweightGateSystem`
> (`engine/gates/core/index.ts:143, :229`) — `isGateSystemEnabled()` and `recordValidation()`, both
> of which accept `scope?` and were passed nothing. Consequence: one workspace's gate enable/disable
> state was read by every other, and validation metrics from every project pooled into one row.
>
> Trap worth recording: that file _does_ contain `scope` parameters — `getTemporaryGatesForScope`,
> `cleanupTemporaryGates` — but those are temporary-gate lifetime strings, an unrelated concept
> under the same word. Grepping `scope` in this file reads as already-handled. It was not.
> | 4.5 ✅ | `sqlite-engine.ts:760` + call at `:163` | **Delete** `applyIdentityScopeMigration()` | -70 | 4.2–4.4 | ✅ Fresh DB: booted clean, 9 scope indexes, version_history scope cols present. Existing DB: `verify:mcp` 12/12, 5 workspace indexes, `resource_changes` 272 rows / **0 NULLs** |

> **Line refs drifted:** the row cited `:479` and `:120`; actual were `:760` and `:163`. Nothing
> referenced the method outside its own file, so the deletion was self-contained.
>
> All three of the migration's jobs were dead by removal, each for a different reason worth keeping
> straight: the `ALTER TABLE ADD COLUMN` pair because `applySchema()` declares both columns and any
> older database is recreated through it; the `UPDATE … WHERE NULL` backfill because all five
> tables now have conforming writers; the eight `CREATE INDEX IF NOT EXISTS` statements because
> they are duplicated verbatim at `sqlite-engine.ts:536-548`.
>
> The index duplication is the one no other test observed — the writers each have their own
> coverage, but deleting one of two identical index copies is safe _only_ because the other exists.
> `sqlite-backend.test.ts` now reads `sqlite_master` for all eight and `PRAGMA table_info` for the
> five tables, inside the schema-bump block so it asserts against a post-recreate database.
> Removing one index from `applySchema()` fails it.

**Gate**: `npm run validate:all && npm run test:integration` + manual two-workspace probe

> **4.5 is blocked by more than 4.2–4.4 (found 2026-08-04).** The row above assumes conforming the
> listed writers makes the migration redundant. It does not. `applyIdentityScopeMigration` backfills
> **five** tables — `chain_sessions`, `kv_state`, `chain_run_registry`, `version_history`,
> `resource_changes` — and 4.2/4.3/4.4 only reach `kv_state` and `resource_changes`. Deleting it
> leaves `chain_sessions`, `chain_run_registry`, and `version_history` writing NULL scope with
> nothing repairing them, which is the same phantom-column state Tier 4 exists to end — now made
> permanent rather than papered over. Those three are Tier 6.1's territory.
>
> **Resolution taken: (a), partially — 2 of 3 landed as 4.6.** `chain_sessions` (via
> `projectToHookView` + a `defaultScope` on `ChainSessionStoreOptions`, supplied from
> `prompt-executor.ts`) and `chain_run_registry` (via a merged `runScope`: PID still decides
> `tenant_id`, workspace fills the scope columns) now conform. Verified by one integration test in
> `tenant-isolation.test.ts`, falsified against each writer independently. Accepted phantom
> columns fell 8 → 4, and the four now-stale exceptions were removed from `table-contracts.ts`.
>
> **`version_history` is NOT conformable by the same move, and this is the remaining 4.5 blocker.**
> All 9 of its query sites filter on a hardcoded `tenant_id = 'default'` literal — reads, writes,
> prune, rollback, list. Scoping the writes without the reads breaks version numbering; scoping
> both makes every existing row invisible, and the table is **durable**, so that is effective data
> loss of rollback history. The existing rows cannot be attributed retroactively either: they were
> written by many projects under one literal tenant and nothing distinguishes them. The decision
> 6.1 owes: scope going forward while treating legacy `'default'` rows as visible-to-all, or leave
> the table global and declare it. Its two phantom exceptions stay, correctly, pointing at 6.1.
>
> The migration's other two jobs are already safe to drop: its `ALTER TABLE ADD COLUMN` calls are
> no-ops now that `applySchema()` declares both columns, and all 8 of its `CREATE INDEX` statements
> are duplicated verbatim at `sqlite-engine.ts:536-548`. Deleting it loses no index.

### Tier 5 ✅ COMPLETE 2026-08-05 — Lifecycle correctness.

| #      | File                                                   | Change                                                                               | ~Lines | Depends | Verify                                                                                                                        |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 5.1 ✅ | `sqlite-engine.ts:754` `shutdown`                      | `PRAGMA wal_checkpoint(TRUNCATE)` before `db.close()`                                | +37    | none    | ✅ Live: WAL **4,152,992 → 0 bytes** across a real SIGTERM. Main DB 598,016 → 659,456 — the log was checkpointed IN, not lost |
| 5.2 ✅ | `application.ts:570`                                   | Call `SqliteEngine.shutdown()` **last**, after the 9 subsystems that may still write | +9     | 5.1     | ✅ Ordering asserted in `database-lifecycle-posture.test.ts`; falsified by moving the close to the top of `shutdown()`        |
| 5.3 ✅ | `module-initializer.ts:139,257,306` + `application.ts` | Throw instead of `logger.warn` on init failure                                       | +32    | 5.2     | ✅ Broken `runtime-state` path → `initializeModules()` rejects; falsified by reverting site 1 to `logger.warn`                |

**Gate**: ✅ `npm run build && npm run verify:mcp` (12/12) + real restart with WAL measured
before/after · `test:ci` 1945 pass · `test:integration` 471 pass · typecheck clean · both ratchets
no regressions · `validate:arch`, `validate:table-contracts`, `validate:no-phantom-columns`,
`validate:filesize`, `validate:contracts`, `validate:state-field-writers`,
`validate:no-crosslayer-reexport`, `validate:package-entries` all pass individually.
`validate:all` exits 123 on `validate:format` against `.claude/rules/mcp-contracts.md` — a file
with an empty working diff, last written by `84b74cfa`, i.e. the pre-existing red step recorded in
the Tier 1 gate note (C2). Not attributable here.

> **Every line reference in this tier had drifted.** `shutdown` was at `:754` not `:553`; the
> module-initializer swallow sites at `:139, :257, :306` not `:127, :221, :270`. Re-measured before
> acting, per the untrusted-inventory rule.
>
> **5.2 needed a new static, because the obvious call is wrong.** `SqliteEngine.getInstance()`
> CREATES an engine when none exists, so calling it from `shutdown()` would open a database handle
> during teardown and checkpoint a file nobody wrote. Added `SqliteEngine.shutdownInstance()`,
> which no-ops on a null singleton. Covered by its own test.
>
> **The 4th F7 site is not an init site, and "throw" was the wrong fix for it.** The plan groups
> `application.ts` with the three module-initializer sites, but its catch is inside
> `fullServerRefresh()` — a hot-reload path whose outer boundary at `:807` already logs `error` and
> re-throws. That is the double-catch `architecture.md` names: the outer boundary never fired
> because the inner one hid the failure, and the refresh went on to report "completed successfully"
> over a stale index. Fix was **deleting the inner catch**, not adding a throw.
>
> **Site 3's catch is unreachable for the failure mode 5.3 targets.** `syncAll()` catches per
> resource type internally and reports failures through `SyncResult.errors` rather than throwing,
> so that catch fires only if the engine or the dynamic imports fail — the same root cause that
> already threw at the DatabasePort site above it. Corrected for posture consistency; **no test
> claims to reach it**, and the code says so at the site.
>
> **New finding, not fixed here.** `SyncResult.errors` is never checked: `module-initializer.ts`
> logs "✅ ResourceIndexer synced to SQLite" whatever the error count. That is the same
> reports-success-while-broken class as F7, but closing it means deciding a policy on partial index
> failure — a design decision, not a lifecycle correction. Belongs with 6.4, not Tier 5.
>
> **Scope-constraint deviation.** _Explicitly out of scope_ requires "no net lines" in
> `application.ts`. It grew **+9** (29 added / 20 removed) — but **−1 executable line**, since the
> deleted `try`/`catch` outweighs the two added statements and the rest is the comment explaining
> why the close must be last. The tier row itself budgeted ~10 lines for 5.2, which contradicts the
> stricter criterion; recording the number rather than reading the looser rule as permission.
>
> **A checkpoint failure is deliberately logged, not thrown** — the one place this tier does not
> apply its own rule. `SQLITE_BUSY` while a reader holds the file is not data loss: the WAL stays
> valid and the next clean close retries. Throwing would skip `db.close()` and leak the handle,
> trading a large file for a lost one. Asserted by a test that stubs the PRAGMA to throw.

### Tier 6 — Consolidate access paths, bound growth, disambiguate `tenant_id`. **6.1/6.3/6.4 done; 6.2 blocked; 6.5–6.6 open.**

> **6.2 is blocked because its premise is false, and the plan recorded the opposite.**
> Phase 2.5 correction #3 states `verify-state.db` is "code-only and has never executed a write",
> reclassifying 6.2 from "consolidate a live store" to "remove an unexercised path". Re-measured
> 2026-08-05: `hooks/lib/verify_active_store.py` both READS and WRITES that database, consumed by
> `ralph-stop.py`, `ralph-context-tracker.py`, and `compact-recovery.py`, with two pytest files
> covering it. The file is absent from disk only because nobody has run `:: verify:"cmd" loop:true`
> in this workspace — an unexercised **feature**, not dead code. The store's own docblock
> ("so Python hooks can read it independently") is therefore accurate, not stale.
>
> Consequence: folding `verify_active_state` into `state.db` is a cross-language contract change of
> the same class as 6.5/6.6 — it must update the Python library, land atomically, and verify with
> `validate:python` + pytest. It is not the `~-45` line deletion budgeted, and `npm run test` cannot
> observe it. It also deserves re-deciding rather than re-scheduling: a separate database is a
> defensible design for a file two languages poll, and consolidating adds WAL contention on the main
> database to buy tidiness.
>
> What IS confirmed is the 6.1 defect, twice more: the TS store and the Python library each carry
> their own `CREATE TABLE IF NOT EXISTS verify_active_state`. The two DDLs are byte-identical today,
> so nothing is broken — but that is two independent schema owners for one table, which is exactly
> the shape that produced the 6.1 startup failure once they drifted.
>
> **6.3 forced the `DROPPED_ON_THIS_BUMP` retirement, and the gate built for it fired.** Deleting
> `tenants` from `applySchema()` required `SCHEMA_VERSION` 18 → 19, and `validate:table-contracts`
> then rejected the stale exclusion by name until the set was emptied and `DROPPED_AT_VERSION`
> moved together. Verified by mutation: re-introducing the stale pair fails the gate with the exact
> message it was written to emit. The v18 test that asserted `version_history` is DROPPED has
> flipped back to PRESERVED, as its own comment said it would.
>
> **6.4 found the retention declarations were nearly all honest, and one was a lie.**
> `execution_records` declared `unbounded-justified` with a `retentionRationale` whose text was the
> word PLACEHOLDER — F8 documented in the contract rather than fixed. It now declares
> `{ maxRows: 5000 }`, an order of magnitude above the reader's 500-row clamp.
>
> Two design corrections against the row as written:
>
> 1. **The inline trim was not simply removed.** The row says "remove inline trim", but a
>    startup-only pass lets the one table measured AT its cap and actively evicting grow unbounded
>    for a whole session. The trim now _delegates_ to `enforceRetention(db, logger, 'resource_changes')`
>    — one implementation, two call sites — instead of holding a second hand-rolled DELETE that
>    could drift from the declared cap. It previously did exactly that, against a `maxEntries`
>    config value rather than the contract.
> 2. **Only `{ maxRows }` is enforced generically**, and the test asserts the limit rather than
>    leaving it implied. `{ maxRowsPerResource }` needs partition columns that differ per table and
>    `version_history` already prunes correctly at its write sites; a generic second pass would add
>    a way to be wrong without adding coverage. A near-miss worth recording: had `kv_state` declared
>    `maxRows: 1` (as `schema_version` does) a generic pass would have deleted every workspace's
>    framework state but one. It declares `unbounded-justified`, so it does not — but that is the
>    hazard a declaration-driven DELETE carries.
>
> **Phantom config found in passing, not fixed**: `resources.logs.maxEntries` is user-settable and
> range-validated (50-5000), and reaches nothing — `initializeResourceChangeTracker` hardcodes 1000.
> It was already inert before this tier. Marked `@deprecated` at the type; removing it is a
> config-surface change (schema + validator + docs), not a retention one.
>
> **Seventh stale declaration**: `execution_records` still carried `readers: []` after Tier 3 gave
> it two. Corrected here. No gate detects a satisfied exception or an out-of-date `readers` list.

> **6.1 was not cleanup. It was a live startup defect, and the plan under-rated it.**
> The row reads as "remove a redundant access path, save ~120 lines". Reproduced 2026-08-05:
> the embedded Python helper's `ensure_schema()` predated the identity-scope columns, so a `cpm`
> invocation on a machine where the server had never run created `version_history` **without**
> `organization_id`/`workspace_id` and wrote no `schema_version` row. The engine then read version
> 0, took its fresh-database path, and `CREATE TABLE IF NOT EXISTS` silently no-opped against the
> existing table — the scope columns stayed absent and `applySchema()` threw
> `no such column: workspace_id` while building the scope index. **The MCP server could not start.**
> After Tier 5.3 that is a hard startup failure rather than a degraded boot.
>
> **Tier 4 also split the two writers apart, which nobody noticed at the time.** Scoping the nine
> TS query sites left the Python helper still filtering `tenant_id = 'default'`, so from Tier 4
> until now CLI-written and server-written history were mutually invisible. 6.1 closes that by
> resolving the same id through `shared/utils/project-scope.ts`.
>
> **`deriveProjectScopeId` moved to `shared/` (L0).** `cli-shared` must derive the same scope as the
> server but cannot import `runtime/` — `modules/` already imports `cli-shared`, so that edge closes
> a cycle `no-circular` blocks. `runtime/options.ts` re-exports it, so its consumers are unchanged.
>
> **Known limitation, recorded not hidden**: a server launched with an explicit `--workspace-id`
> flag still diverges from the CLI, because nothing on disk records which flag the server was
> started with. The CLI mirrors the config→derived→`'default'` precedence, which covers the common
> case. Closing it needs the server to persist its resolved scope.
>
> **The line estimate was wrong in sign.** The row budgets ~-120; actual is **+6** (312 added / 306
> removed). 262 lines of that deletion were a Python source string being replaced by typed,
> prepared-statement TypeScript. Fewer lines was never the point.
>
> **The foreign-writer exception was rewritten, not deleted.** The CLI is still a second writer —
> `cpm` has no server to route through — so the exception stays, but its `reason` and `closedBy`
> now describe what is actually true. It had gone stale the moment the rewrite landed, and neither
> gate detects a satisfied exception. Sixth occurrence of that blind spot this initiative.
>
> **A test that could not fail was caught by falsification.** The first version of
> `cli-schema-ownership.test.ts` asserted schema ownership, but the `existsSync(db_path)`
> short-circuit fired first, so mutating the schema check changed nothing and all three tests still
> passed. The two guards are now exercised separately and each mutation fails exactly its own test.
>
> **Remaining Tier 6 work, and why it is not batched here**: 6.3 deletes `tenants` from
> `applySchema()`, which existing databases still carry — so it forces `SCHEMA_VERSION` 18 → 19,
> and the v19 bump in turn forces the `DROPPED_ON_THIS_BUMP` retirement that
> `validate:table-contracts` gates. 6.5/6.6 changes the Python hook contract, declared **public API**
> in CLAUDE.md, and must land in one PR. Both are user-data-affecting and deserve their own session
> rather than being appended to a passing one.

| #      | File                                    | Change                                                                                                                                     | ~Lines | Depends | Verify                                                                                                                            |
| ------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 ✅ | `cli-shared/version-history.ts`         | Replace `spawnSync(python3)` + duplicate `ensure_schema` with `node:sqlite`                                                                | **+6** | T1      | ✅ Versioning integration + unit suites 40 pass, `cli-shared` 80 pass; 3 new regression tests, each guard falsified independently |
| 6.2 ⛔ | `verify-active-state-store.ts:55`       | Fold `verify_active_state` into `state.db` via `DatabasePort`; delete the private `DatabaseSync`                                           | ~-45   | 6.1     | **BLOCKED — premise false, see below**                                                                                            |
| 6.3 ✅ | `sqlite-engine.ts:457`                  | Delete `tenants` + seed; update the 3 tests that insert into it                                                                            | -33    | T1      | ✅ `validate:table-contracts` — 9 tables; live v19 bump verified on the real `state.db`                                           |
| 6.4 ✅ | `sqlite-engine.ts` + new `retention.ts` | One startup pass driven by `TABLE_CONTRACTS.retention`; remove inline trim at `resource-change-tracker.ts:281`                             | +96    | T1, 6.3 | ✅ 6 tests in `retention.test.ts`, falsified two ways                                                                             |
| 6.5    | `manager.ts:351` + schema               | Add `run_owner_pid`; `tenant_id` becomes scope-only. **Keep writing `tenant_id`=PID one release**; hooks read the new column with fallback | ~55    | 6.4     | `validate:python` + live hook probe                                                                                               |
| 6.6    | `hooks/lib/db_reader.py:195-240`        | Read `run_owner_pid` with `tenant_id` fallback                                                                                             | ~30    | 6.5     | `python3 -m pytest hooks/tests`                                                                                                   |

**Gate**: `npm run validate:all && npm run validate:python && npm run verify:mcp`

### Sequencing rules

- T0 and 2.4 have no dependencies — parallelizable with anything
- 3.2 / 3.3 / 3.4 are independent of each other after 3.1, but **3.3 and 3.4 must land with 3.2** —
  shipping the `execution_history` action without the direct view or the terminal writes exposes a
  reader that returns nothing useful
- 4.2 / 4.3 / 4.4 are independent after 4.1
- **6.5 → 6.6 must land in ONE PR** — a new column's writer and reader cannot split
- No tier exceeds 6 files; each is one agent session

### New-file justifications

1. **`infra/database/table-contracts.ts`** — cannot live in `sqlite-engine.ts`: three build-time
   scripts import it as data, and importing the engine would pull `node:sqlite` and the singleton
   into gate processes.
2. **`scripts/validate-table-contracts.js`** — matches 30 single-purpose `validate:*` precedents.
   The raw-write rule is folded in rather than becoming a fourth script.
3. **`scripts/validate-no-phantom-columns.js`** — distinct defect class (column vs table) and
   distinct parse target. Merging would yield one gate whose failure cannot name the rule.
4. **`.claude/rules/sqlite-persistence.md`** — joins 2 existing project rules; fails CLAUDE.md's
   eviction test as always-load content.

### Carried forward from the superseded plan

`plans/state-db-redundancy-cleanup.md` (deleted 2026-08-03) tracked five redundancies. Re-measured
against the current tree, three are closed and two survive:

| Old item                                                 | Status now                                                                                                                                                                                                       | Disposition                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| #4 Consolidate `ChainRunRegistry` implementations        | **Done** — `SqliteChainRunRegistry` no longer exists; only `DirectChainRunRegistry` remains                                                                                                                      | Closed                                        |
| #1 Consolidate 5 KV-blob tables into `kv_state`          | **Done** — `kv_state` exists with a `key` discriminator; 4 tables collapsed                                                                                                                                      | Closed                                        |
| #2 Dual-write `chain_run_registry` + `chain_sessions`    | **Partly done** — `persistSessions()` now wraps both in one transaction (option 3A landed). Full normalization (3B/3C) is owned by the execution-ledger initiative's Tier 10, which retires `chain_run_registry` | Tracked elsewhere — do **not** duplicate here |
| #3 Promote `chain_sessions.state` JSON fields to columns | **Open**                                                                                                                                                                                                         | Folded into **6.5** — see below               |
| #5 `resource_changes` ↔ `version_history` overlap        | **Open, now answerable**                                                                                                                                                                                         | Resolved by the posture model — see below     |

**#3 folds into 6.5.** `v_execution_status` runs `json_extract` on every read for `currentStep`,
`totalSteps`, `lifecycle`, `pendingGateReview`, `pendingShellVerification`, `lastActivity` — fields
the writer already knows. It is a half-finished migration: `chain_id`, `run_status`, and
`run_completed_at` are already columns. Since 6.5 alters `chain_sessions` anyway (adding
`run_owner_pid`), promote these six in the same change and the same schema bump — one migration
instead of two, and `v_execution_status` becomes a plain SELECT. Add ~40 lines to 6.5 and update
`projectToHookView` (`manager.ts:351`) to write columns rather than a JSON blob.

**#5 is answered by the posture model, not by an investigation.** The old plan proposed ~2h of
grepping to decide whether the two tables are redundant. They are not: `version_history` is
`posture: 'durable'` (snapshots that exist nowhere else — this is exactly what F11 was destroying)
while `resource_changes` is `posture: 'derived'` with a 1000-row cap and is _actively evicting_. A
table you may truncate at any time cannot be the source for one you must never lose. Record both
postures in `TABLE_CONTRACTS` (1.1) with a comment naming this decision, and close the item — no
investigation needed.

### Explicitly out of scope

`manager.ts` (2054 ln) and `application.ts` (1311 ln) both exceed the >1000 Critical size
threshold. This plan touches both and must add **no net lines** — 5.2 and 6.5 are
single-line-class insertions. Decomposition is a separate effort; growing them here would
compound the escalation.

---

## Phase 4–6 — Validation & Completion

### Testing strategy

| What to test                                      | Type                | Location                                                | Why this type                                                                         |
| ------------------------------------------------- | ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Durable tables survive a SCHEMA_VERSION bump      | Integration         | `tests/integration/database/sqlite-backend.test.ts`     | Needs a real engine + real version transition; a mock cannot exercise `dropAllTables` |
| DDL set === `TABLE_CONTRACTS` set                 | Gate self-test      | `scripts/validate-table-contracts.js --self-test`       | Build-time invariant, not runtime behavior                                            |
| A deliberately unwritten column is caught         | Gate self-test      | `scripts/validate-no-phantom-columns.js --self-test`    | The gate's own false-negative risk is the thing under test                            |
| Two workspaces get distinct gate/arg-history rows | Integration         | `tests/integration/tenant/workspace-continuity.test.ts` | Scope isolation is only observable across two real scopes                             |
| WAL checkpoints on shutdown                       | Manual + build gate | `npm run verify:mcp` + file-size probe                  | File-size effect is not assertable in-process                                         |
| Init failure fails startup                        | Unit                | new test in `tests/unit/database/`                      | Error posture is a contract, not a behavior chain                                     |
| Hook read path survives `run_owner_pid`           | Python              | `hooks/tests/`                                          | Cross-language contract; pytest is the only real consumer                             |
| Retention trims to declared caps                  | Integration         | `tests/integration/database/`                           | Requires seeding over-cap rows against a real engine                                  |

### Done criteria

| Criterion                       | Validation                                                           | Pass condition                                        |
| ------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| No undeclared or dead tables    | `npm run validate:table-contracts`                                   | Exit 0                                                |
| No table has zero readers       | same gate                                                            | Zero `readers: []` entries                            |
| No phantom columns              | `npm run validate:no-phantom-columns`                                | Exit 0                                                |
| No raw writes outside owners    | `validate:table-contracts`                                           | Exit 0                                                |
| Version history survives a bump | `npm run test:integration`                                           | New durable-survival test green                       |
| Workspace isolation real        | Two-workspace probe                                                  | `kv_state[key='gates']` has >1 row                    |
| WAL bounded                     | Restart + `ls -la runtime-state/`                                    | WAL ≪ main DB after clean shutdown                    |
| Init failures are loud          | Unwritable `dbPath`                                                  | Startup exits non-zero                                |
| Full suite                      | `npm run validate:all && npm run validate:python && npm run test:ci` | All green                                             |
| No scope creep                  | `git diff main --stat`                                               | No net line growth in `manager.ts` / `application.ts` |

### Documentation

| Doc                              | Update                                                    |
| -------------------------------- | --------------------------------------------------------- |
| `CLAUDE.md` §Runtime State       | Correct the workspace-scope claim; add the posture column |
| `docs/architecture/overview.md`  | Add the persistence-boundary section                      |
| `docs/guides/identity-scope.md`  | Document `tenant_id` vs `run_owner_pid`                   |
| `docs/guides/troubleshooting.md` | Add WAL growth and startup-failure symptoms               |
| `hooks/README.md`                | Document the `run_owner_pid` read with fallback           |
| `CHANGELOG.md`                   | `[Unreleased] → Fixed` (entry below)                      |

### Risks

| Risk                                                               | Impact                                 | Mitigation                                                                                                                                                   | Rollback                                        |
| ------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| F3 column change breaks downstream hook plugins                    | High — public API                      | Additive column + dual-write for one release; 6.5/6.6 in one PR                                                                                              | Revert the PR; `tenant_id` still written        |
| Init-throws (5.3) turns a soft degrade into a startup failure      | High — server won't boot on a bad path | Land after 5.1/5.2 are verified; the error names the path                                                                                                    | Revert 5.3 alone; independent commit            |
| Gates flag pre-existing violations and block all work              | Medium                                 | Land T1 with current state as the accepted baseline; tighten per tier                                                                                        | Ratchet mode, per `eslint-ratchet.js` precedent |
| The new `execution_history` action becomes a second unread surface | Medium — recreates F1 under a new name | The `readers: []` gate covers the table, not the MCP action; add one integration test that exercises the action end-to-end so the reader has a live consumer | Revert 3.2; the ledger and view remain          |
| `v_execution_history` diverges from `v_execution_status`           | Low — two views, one truth             | Both are declared in `TABLE_CONTRACTS` with `execution_records` as the single owner; 1.3 flags DDL outside the owner                                         | Drop the new view; SCHEMA_VERSION bump rebuilds |
| Retention pass deletes wanted rows                                 | Medium                                 | Caps declared per table and reviewed before 6.4 lands                                                                                                        | Caps are data, not code — raise and restart     |

### Release

- **commit_convention**: `fix(server): <description>` for T0/T4/T5; `feat(scripts): <description>`
  for T1 gates; `docs(docs): <description>` for T2
- **scope**: `server`, `scripts`, `hooks`, `docs`, `config`
- **changelog** (`Fixed`): Declared per-table ownership, scope semantics, durability posture, and
  retention for the SQLite state layer, enforced by new validation gates. Fixes silent loss of
  resource version history on schema-version bumps, restores workspace isolation for gate state and
  argument history, adds WAL checkpointing and database shutdown, and makes database initialization
  failures fail startup instead of degrading silently.

### Growth capture

- [ ] **Pattern**: "phantom column" — a schema-level sibling of the phantom-field class already
      caught by `validate-state-field-writers.js`. Generalizable: _a declared slot with readers
      and no writers is a defect regardless of substrate._ Candidate for `/refactoring`.
- [ ] **Pattern**: "migration treadmill" — a startup backfill fighting a non-conforming writer.
      The backfill masks the defect and its removal exposes it. Candidate for `/sqlite`.
- [ ] **Memory**: `reference_sqlite_persistence.md` needs the 3-file / 4-access-path reality and
      the `tenant_id` trisemy; it currently describes the engine as if it were the only path.
- [ ] **Skill correction**: `/sqlite` has no durability-posture or single-writer content —
      Tier 2.1 is the fix.
- [ ] **Prompt defect**: `implementation_plan` fires the visual/creative design-enrichment block on
      persistence work, and its Phase-2.5 guard checks `## Context`/`## Analysis`/`## Goals` while
      the prompt body specifies `context_establishment`/`systematic_analysis`/`goal_definition`.
      Both are worth fixing in the prompt.

---

## Deviation log

`plans/sqlite-layer-remediation-2026-08-03-implementation-notes.md` — take the conservative option,
log what forced it, continue. Stop and re-plan only if a deviation invalidates a tier's premise.

**Read it before starting Tier 4 or Tier 6.** Executing T0+T1 changed what those tiers owe:

- **R3** — 8 phantom scope columns across 4 tables, where the audit named only `execution_records`.
  Tier 4.3 now owns `resource_changes`, Tier 6.1 owns `version_history` (rollback history is
  currently global across every project sharing `state.db` — not previously stated), Tier 6.5 owns
  `chain_sessions`.
- **R2** — `validate:no-phantom-columns` does **not** catch F2. `execution_records` names both scope
  columns in its INSERT and binds NULL to them, so the gate passes it. Tier 4.1 remains the only
  thing that fixes it; do not read a green gate as evidence F2 is closed.
- **C1** — `kv_state` holds four discriminator keys with two different postures, and today a schema
  bump discards the active framework, gate state, and argument history. Open scoping question, not
  owned by any tier.
- **C2** — three `validate:all` steps were already red before this work; do not attribute them here.
