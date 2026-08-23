---
paths:
  - "server/src/infra/database/**"
  - "server/src/**/*-store.ts"
  - "server/src/**/*-registry.ts"
  - "server/src/**/*-indexer.ts"
  - "server/scripts/validate-table-contracts.ts"
  - "server/scripts/validate-no-phantom-columns.ts"
---

# state.db Persistence Rules

**Declared table contracts over inferred storage behavior; durable migration over blind recreation.**

`server/src/infra/database/table-contracts.ts` owns table owner, posture, scope, retention, readers,
and accepted exceptions. When prose differs, the contract module wins.

## Critical Constraints

- Enumerate every reader, writer, and projecting view before changing a table or column.
- Only `SqliteEngine.applySchema()` may create tables in `state.db`; alternate clients may write
  data but must share the engine-owned DDL and `shared/utils/project-scope.ts` scope derivation.
- A schema bump snapshots and restores durable tables. Do not skip their drop: `CREATE TABLE IF NOT
EXISTS` would preserve obsolete DDL. A new required durable column needs an explicit migration.
- `DROPPED_ON_THIS_BUMP` is a one-version deletion instrument. Keep it aligned with
  `DROPPED_AT_VERSION`, then empty it on the next bump.
- Scope reads and writes together. `run_owner_pid` is process lifetime; `workspace_id`/`tenant_id`
  are isolation dimensions. Do not infer one from the other.
- Defaulted columns evade the phantom-column writer check. Avoid a default when a missing writer
  must fail visibly.
- Every accepted exception needs `closedBy`; shared exception hygiene rejects satisfied,
  unreachable, or malformed entries. Do not preserve an exception after its condition closes.
- A green phantom-column gate proves a writer names the column, not that it binds meaningful values.

## Adding or Changing Storage

1. Update `applySchema()` and `TableContract` together.
2. Declare posture, scope, retention, owner, and real readers; `readers: []` requires a finding.
3. Verify all mutation sites await persistence and propagate failures.
4. Run both database gates and their self-tests.

```bash
npm run validate:table-contracts
npm run validate:no-phantom-columns
```

Current table map, view behavior, scope details, and schema history:
`docs/architecture/sqlite-persistence.md`.
