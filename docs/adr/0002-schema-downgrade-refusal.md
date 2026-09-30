# ADR 0002: Refuse Schema Downgrades During Initialization

- Status: proposed
- Date: 2026-09-30
- Owners: @minipuft

## Context

Server generations can share one runtime database. Recreating every mismatched schema lets an
older engine replace tables newer processes still use. Its durable-table inventory cannot name
tables introduced later, so snapshot/restore can discard historical bytes that exist nowhere else.
Treating an unreadable version record as zero can also misclassify an existing database as fresh.
[Gate-resolution precedence](0001-gate-resolution-precedence.md) does not define this storage policy.

## Decision

`SqliteEngine` refuses a version newer than its embedded `SCHEMA_VERSION` before WAL, table, view
or repair mutation. The refusal names the path, observed and supported versions, and the compatible
engine or isolated `MCP_RUNTIME_ROOT` remedy. This policy changes no schema version or tool parameter.

An existing `schema_version` authority must be a table with exactly one positive safe-integer
version. Wrong shape, empty/multiple records, invalid values and unreadable authority refuse startup.
Missing authority means fresh only when no application tables or views exist. Initialization failure
closes and clears the handle; a close failure preserves the original error.

Fresh creation and current-version reopening remain supported. An older supported schema follows
the existing snapshot/drop/recreate/restore transition for known durable tables. Table postures and
ownership remain defined in `table-contracts.ts`; this decision adds no parallel migration owner.

The check belongs to startup. Both STDIO and Streamable HTTP initialize persistence through the
shared runtime before serving. This decision adds no per-operation version fence.

## Alternatives considered

1. **Continue blind downgrade recreation.** Rejected: an older engine cannot preserve durable tables
   it does not know, and replacing their shapes invalidates already-open newer consumers.
2. **Guess a version or patch the reported missing column.** Rejected: that invents authority and
   leaves other consumers incompatible without proving durable preservation.
3. **Add a full per-operation version fence.** Outside this bounded startup contract; it requires
   separate transaction/lifecycle evidence and still cannot retrofit legacy binaries.

## Consequences

### Positive

- Incompatible startup reports a refusal before destructive schema changes.
- Known durable history retains the existing forward-upgrade path and its regression controls.

### Negative / risks

- Callers that relied on downgrade recreation must use a compatible engine or isolate the runtime.
- Unguarded older binaries can still replace a shared schema. An already-initialized guarded process
  does not revalidate another writer's replacement; incompatible writers need coordination.
- Recovery needs a coherent SQLite backup including WAL, durable inventory and a copy rehearsal.
  Forward upgrading preserves surviving data; it cannot invent missing historical object bytes.

### Follow-ups

- Review/adopt this proposed record with the compatibility change before release.
- Coordinate compatible runtime owners when recovering a shared file; do not delete the original
  database or substitute a one-column repair for the engine-owned transition.

## Validation

- [Database refusal fixtures](../../server/tests/integration/database/sqlite-backend.test.ts) exercise
  malformed/unreadable authority, native handle cleanup, fresh creation and older-schema controls.
- [Durable preservation](../../server/tests/integration/database/durable-round-trip.test.ts) compares
  all durable rows, unknown tables/views, journal mode and file bytes after refused newer startup.
  Disabling the newer-version guard makes its file-preservation assertion fail.
- [Forward-upgrade controls](../../server/tests/integration/database/schema-v29.test.ts) retain
  projected history and recorded object bytes. These fixtures do not establish live-runtime recovery.
- Transport composition is shared: [module initialization](../../server/src/runtime/module-initializer.ts)
  awaits the engine before [application startup](../../server/src/runtime/application.ts) serves.

## References

- [Schema owner](../../server/src/infra/database/sqlite-engine.ts) and
  [table contracts](../../server/src/infra/database/table-contracts.ts).
- [Persistence policy](../architecture/sqlite-persistence.md#schema-compatibility-and-initialization).
- [Shared-runtime recovery](../guides/troubleshooting.md#recover-a-shared-runtime-after-schema-incompatibility).
