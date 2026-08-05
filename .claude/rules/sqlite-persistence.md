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

## The Map (10 declared tables + 1 view)

Not 11. SQLite auto-creates `sqlite_sequence` for any table declaring `AUTOINCREMENT`; it is never
declared in `applySchema()` and is excluded via `SQLITE_INTERNAL_TABLES`. A startup assert written
against a raw `sqlite_master` count throws on every boot.

| Table                   | Owner                                               | Posture     | Scope         |
| ----------------------- | --------------------------------------------------- | ----------- | ------------- |
| `schema_version`        | `sqlite-engine.ts`                                  | derived     | none          |
| `tenants`               | `sqlite-engine.ts`                                  | derived     | none          |
| `chain_sessions`        | `modules/chains/manager.ts`                         | derived     | run-owner-pid |
| `kv_state`              | `stores/sqlite-store.ts`                            | ephemeral   | workspace     |
| `resource_index`        | `resource-indexer.ts`                               | derived     | none          |
| `skills_sync_manifests` | `modules/skills-sync/service.ts`                    | **durable** | client-scope  |
| `version_history`       | `modules/versioning/version-history-service.ts`     | **durable** | workspace     |
| `resource_changes`      | `observability/tracking/resource-change-tracker.ts` | derived     | workspace     |
| `chain_run_registry`    | `modules/chains/run-registry.ts`                    | ephemeral   | run-owner-pid |
| `execution_records`     | `modules/chains/execution-record-store.ts`          | ephemeral   | workspace     |

View: `v_execution_status`. It selects `FROM chain_sessions`, which is PID-deleted at cleanup, so
it structurally cannot observe a completed run.

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

## `tenant_id` Means Three Different Things

Same column name, three semantics. A filter written against the wrong one is not type-detectable.

| Value               | Tables                                                     | Consequence                                             |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| Server PID          | `chain_sessions`, `chain_run_registry`                     | Row dies with the process — a session key, not a tenant |
| Workspace id        | `kv_state`                                                 | Genuine isolation                                       |
| Literal `'default'` | `execution_records`, `version_history`, `resource_changes` | No isolation                                            |

## Workspace Isolation Is Claimed Widely, Delivered Once

`kv_state` is the only table whose scope columns are actually written. Four tables declare **and
index** `workspace_id` / `organization_id` and never populate them, so their rows are global across
every project sharing the file:

`chain_sessions` · `version_history` · `resource_changes` · `chain_run_registry`

`version_history` is the one with user-visible consequence: **rollback history is shared across
every project on this machine.**

Each is an `acceptedPhantomColumns` entry naming the tier that closes it. Adding a scope column
without a writer is not neutral — it states an isolation guarantee the data does not honor.

## `state.db` Is Shared Across Projects

One file serves every project; isolation comes from `workspace_id`, not from separate databases.
The scope id derives from `CLAUDE_PROJECT_DIR` → cwd basename unless `--workspace-id` is passed.
Never commit `state.db`.

## Four Access Paths, Not One

`SqliteEngine` is not the only writer of `state.db`. `src/cli-shared/version-history.ts` reaches it
by `spawnSync`-ing `python3` from a Node process that already has `node:sqlite`. There are also two
other database files: `hooks-state.db` (Python) and `verify-state.db`.

Before assuming a table has one writer, run the gate — it enumerates every SQL site.

## Gates

| Command                               | Enforces                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `npm run validate:table-contracts`    | Contract set-equality vs the embedded DDL, posture coherence, reader/owner paths exist, single-writer, exception hygiene |
| `npm run validate:no-phantom-columns` | Every declared column has a writer or a declared exception                                                               |

Both run in `validate:all` with `--self-test` variants.

**Known blind spot**: `validate:no-phantom-columns` catches _declaration-dead_ columns (no writer
names them). It does **not** catch _value-dead_ columns — a writer names the column and always
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
