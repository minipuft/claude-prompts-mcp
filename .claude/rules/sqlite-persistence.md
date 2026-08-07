---
globs:
  - "**/infra/database/**"
  - "**/*-store.ts"
  - "**/*-registry.ts"
  - "**/*-indexer.ts"
---

# state.db Persistence Rules

**Declared table properties over inferred ones; the contract module over this file.**

`server/src/infra/database/table-contracts.ts` is the SSOT for owner, posture, scope, and
retention. This file is the orientation map and the traps — when the two disagree, the contract
module wins and this file is stale.

## The Map (9 declared tables + 2 views)

Not 10, and not 11. `tenants` was deleted at v19 (F10). SQLite auto-creates `sqlite_sequence` for any table declaring `AUTOINCREMENT`; it is never
declared in `applySchema()` and is excluded via `SQLITE_INTERNAL_TABLES`. A startup assert written
against a raw `sqlite_master` count throws on every boot.

| Table                   | Owner                                               | Posture     | Scope         |
| ----------------------- | --------------------------------------------------- | ----------- | ------------- |
| `schema_version`        | `sqlite-engine.ts`                                  | derived     | none          |
| `chain_sessions`        | `modules/chains/manager.ts`                         | derived     | run-owner-pid |
| `kv_state`              | `stores/sqlite-store.ts`                            | ephemeral   | workspace     |
| `resource_index`        | `resource-indexer.ts`                               | derived     | none          |
| `skills_sync_manifests` | `modules/skills-sync/service.ts`                    | **durable** | client-scope  |
| `version_history`       | `modules/versioning/version-history-service.ts`     | **durable** | workspace     |
| `resource_changes`      | `observability/tracking/resource-change-tracker.ts` | derived     | workspace     |
| `chain_run_registry`    | `modules/chains/run-registry.ts`                    | ephemeral   | run-owner-pid |
| `execution_records`     | `modules/chains/execution-record-store.ts`          | ephemeral   | workspace     |

Views: `v_execution_status` selects `FROM chain_sessions`, which is PID-deleted at cleanup, so it
structurally cannot observe a completed run. Until v20 it could not observe an in-progress one
either — it json_extracted `$.state.currentStep` while its only writer emitted `currentStep` at the
top level, so both step columns read NULL on every row and the hook's primary read path returned
nothing for every input (F12). `v_execution_history` (added v17) reads
`execution_records` directly and can — it is what the `system_control execution_history` action
projects.

## Two Tables Are Durable — A Schema Bump Must Not Destroy Them

`version_history` holds rollback snapshots that nothing regenerates. `skills_sync_manifests` drives
orphan detection, and `applySyncPrune` deletes directories listed in it — losing it turns a prune
into either a no-op or a deletion of the wrong thing.

`ensureSchema()` snapshots durable rows → drops → `applySchema()` → restores by intersecting old
columns with new. **Do not "optimize" this into skipping durable tables during the drop.**
`applySchema()` uses `CREATE TABLE IF NOT EXISTS`, so a table that is never dropped is never
recreated and its DDL freezes permanently.

Adding a `NOT NULL` column with no default to a durable table makes the restore throw, naming the
table. That is intended: the change needs a real migration.

## `tenant_id` Means Two Things — It Used to Mean Three

The PID meaning got its own name at v20. `chain_sessions` and `chain_run_registry` now declare
`run_owner_pid`, so no column name carries both a run owner and a workspace.

| Value               | Column          | Tables                                                          | Consequence                                             |
| ------------------- | --------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| Server PID          | `run_owner_pid` | `chain_sessions`, `chain_run_registry`                          | Row dies with the process — a session key, not a tenant |
| Workspace id        | `tenant_id`     | `kv_state`, `version_history`, `resource_changes`               | Genuine isolation (Tier 4)                              |
| Literal `'default'` | `tenant_id`     | `execution_records`, and any table with no workspace configured | No isolation                                            |

Two meanings still share `tenant_id`, and a filter written against the wrong one is still not
type-detectable — but the two that were furthest apart no longer collide. The rename was a clean
break with no dual-write: zero downstream readers were measured across `minipuft-plugins`,
`gemini-prompts` and `opencode-prompts`, and both tables are `derived`/`ephemeral` with rows
DELETEd per-PID, so no old-format row could survive the bump that renamed them. `run_owner_pid`
also carries **no `DEFAULT`** — a run owner is known at every write site, and a default of
`'default'` would make the column name a lie for exactly the rows hardest to explain.

## Workspace Isolation (Tier 4 — writers now conform)

Every table that declares scope columns also populates them. Until Tier 4 only `kv_state` did, and
a startup migration backfilled the rest on the next boot — a treadmill against writers that never
stopped emitting NULLs. `applyIdentityScopeMigration` was deleted once each writer conformed:

| Table                | How its scope arrives                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| `kv_state`           | `SqliteStateStore` — PRAGMA-derived column list                                    |
| `resource_changes`   | `defaultScope` on the tracker; the watcher fires with no request to thread         |
| `chain_sessions`     | `defaultScope` on `ChainSessionStoreOptions`, bound in `projectToHookView`         |
| `chain_run_registry` | merged `runScope` — PID decides `run_owner_pid`, workspace fills the scope columns |
| `version_history`    | scope injected into the service; all nine query sites bind it together             |

**`version_history` had to move reads and writes together.** Scoping the writes alone would have
broken version numbering, because `MAX(version)` would read a different set than the INSERT wrote
into. Rows predating the scoping cannot be attributed to a workspace and were dropped by the v18
bump via `DROPPED_ON_THIS_BUMP` — see that constant's retirement rule below.

## One-Time Durable Exclusions Must Retire

`DROPPED_ON_THIS_BUMP` names durable tables deliberately NOT carried across a schema recreate. It
is correct exactly once. Left behind, it silently discards a table whose rows exist nowhere else on
the next, unrelated bump.

`DROPPED_AT_VERSION` records the `SCHEMA_VERSION` it was declared for.
`validate:table-contracts` fails when the two diverge while the set is non-empty, and
`snapshotDurableTables()` throws on the same condition — so a stale exclusion cannot reach a
running server. Retiring it is two edits the gate forces to happen together: empty the set, move
the version.

Prefer this over engine-resident migration code. F5 in the remediation plan was exactly that, and a
one-time step guarded by a marker in `kv_state` is the same shape — `kv_state` is `ephemeral`, so
anything clearing it re-arms the deletion.

## `state.db` Is Shared Across Projects

One file serves every project; isolation comes from `workspace_id`, not from separate databases.
The scope id derives from `CLAUDE_PROJECT_DIR` → cwd basename unless `--workspace-id` is passed.
Never commit `state.db`.

## Three Access Paths, Not One

`SqliteEngine` is not the only writer of `state.db`. `src/cli-shared/version-history.ts` opens the
file directly with its own `DatabaseSync` — the `cpm` binary has no server process to route
through. Tier 6.1 removed the `spawnSync('python3', …)` round-trip and the divergent DDL it
carried, but **not** the second writer, which is declared as an accepted foreign writer.

There are also two other database files: `hooks-state.db` (Python) and `verify-state.db` (declared
in code, never written — Tier 6.2).

**No module outside `SqliteEngine.applySchema()` may create a table in `state.db`.** The CLI used
to carry its own `ensure_schema()` predating the scope columns, so a `cpm` invocation before the
server's first run created `version_history` without `organization_id`/`workspace_id` and wrote no
`schema_version` row. The engine then read version 0, took its fresh-database path, and
`CREATE TABLE IF NOT EXISTS` no-opped against the existing table — leaving the columns absent and
`applySchema()` throwing `no such column: workspace_id`. **The server could not boot at all.**
Reproduced 2026-08-05; guarded by `tests/integration/database/cli-schema-ownership.test.ts`.

A second writer must also resolve the SAME scope id, or its rows are invisible to the other.
`shared/utils/project-scope.ts` holds that derivation precisely so both layers read one definition.

Before assuming a table has one writer, run the gate — it enumerates every SQL site.

## Gates

| Command                               | Enforces                                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run validate:table-contracts`    | Contract set-equality vs the embedded DDL, posture coherence, reader/owner paths exist, single-writer, exception hygiene, **one-time bump exclusions retired** |
| `npm run validate:no-phantom-columns` | Every declared column has a writer or a declared exception                                                                                                     |

Both run in `validate:all` with `--self-test` variants.

**Known blind spot — stale exceptions**: an `acceptedPhantomColumns` / `acceptedForeignWriters`
entry suppresses its finding whether or not it is still true. Tier 4 gave writers to five tables
and every one of their exceptions kept passing silently until removed by hand. Neither gate detects
a satisfied exception; `verify-mcp-surface.mjs` does for its own exemptions, and that is the pattern
to copy. Re-read exceptions whenever a writer lands.

**Known blind spot — value-dead columns**: `validate:no-phantom-columns` catches _declaration-dead_
columns (no writer names them). It does **not** catch _value-dead_ columns — a writer names the column and always
binds NULL, which is the shape of `execution_records.workspace_id`. Do not read a green run as
proof that scope columns carry values.

## Adding a Table

1. Add the `CREATE TABLE` to `applySchema()`
2. Add its `TableContract` — all four properties are required; `derived` must name `rebuiltFrom`,
   and `unbounded-justified` must carry a `retentionRationale`
3. `readers: []` is a finding, not a default — a table nobody reads is either missing a consumer or
   is redundant. Declare a `finding` if you ship it anyway
4. Every `AcceptedException` needs a non-empty `closedBy`. An exception with no exit is a permanent
   bypass wearing a temporary label
5. Run both gates
