# State DB Redundancy Cleanup — Implementation Plan

**Scope**: Address 5 redundancies in `state.db` (SCHEMA_VERSION 15) without breaking hook contracts or chain session continuity.

**Pre-conditions**: SQLite file is ephemeral (drop-and-recreate on schema mismatch is safe). No production migration needed — bumping `SCHEMA_VERSION` triggers a clean rebuild.

**SSOT confirmed for redundancy #2**: `chain_run_registry` (blob) is the source of truth. `chain_sessions` is a derived projection for hook indexed reads. Server reads only the blob at startup; per-row table receives a filtered subset (active sessions only).

---

## Sequencing rationale

```
Tier A (independent, low risk)    Tier B (depends on A)        Tier C (largest refactor)
├── #4 ChainRunRegistry impls     ├── #2 dual-write cleanup    └── #1 KV-blob consolidation
├── #3 v_execution_status promo   └── #5 changes/version review
```

- **Tier A** items are localized, no schema changes, ship independently
- **Tier B** depends on #4 being done so the consolidation has a single write path
- **Tier C** touches every state store consumer — last, with most testing

---

## Phase 1: Consolidate `ChainRunRegistry` implementations (#4)

**Problem**: Two implementations with identical interface — `SqliteChainRunRegistry` (uses `StateStore<T>`) and `DirectChainRunRegistry` (uses `DatabasePort` directly). Comment claims layer-boundary workaround.

**Investigation step**: Verify the boundary claim.

- `grep -rn "SqliteChainRunRegistry\|DirectChainRunRegistry" server/src` to find all instantiations
- Check `dependency-cruiser` rules for `modules/ → infra/` violations
- If boundary is real, document it in the file header and keep both
- If only `DirectChainRunRegistry` is used in practice, delete `SqliteChainRunRegistry`

**Likely target state**: Single `ChainRunRegistry` class taking `DatabasePort`. The `StateStore` abstraction was introduced for the KV blobs — chain registry's read/write pattern (full blob replace) doesn't benefit from it.

**Files**:

- `server/src/modules/chains/run-registry.ts` — collapse to one class
- `server/src/modules/chains/manager.ts` — update construction (line 144)

**Tests**:

- Existing chain session persistence tests — should pass unchanged
- No new tests needed (interface unchanged)

**Risk**: Low. Same interface, same behavior.

**Effort**: ~1 hour.

---

## Phase 2: Promote `chain_sessions.state` JSON fields to columns (#3)

**Problem**: `v_execution_status` view does `json_extract` on every read for fields the writer already knows: `currentStep`, `totalSteps`, `lifecycle`, `pendingGateReview`, `pendingShellVerification`, `lastActivity`. Half-finished migration — `chain_id`, `run_status`, `run_completed_at` already are columns.

**Target state**:

```sql
CREATE TABLE chain_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  organization_id TEXT,
  workspace_id TEXT,
  chain_id TEXT NOT NULL,
  run_number INTEGER NOT NULL,
  session_id TEXT NOT NULL,         -- promoted
  current_step INTEGER NOT NULL,    -- promoted
  total_steps INTEGER NOT NULL,     -- promoted
  lifecycle TEXT NOT NULL,          -- promoted
  pending_gate_review TEXT,         -- promoted (JSON if structured)
  pending_shell_verification TEXT,  -- promoted (JSON if structured)
  last_activity INTEGER,            -- promoted
  run_status TEXT NOT NULL DEFAULT 'working',
  run_completed_at INTEGER,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE (tenant_id, chain_id, run_number)
);
```

**View becomes trivial**:

```sql
CREATE VIEW v_execution_status AS
SELECT
  cs.id AS row_id, cs.session_id, cs.chain_id, cs.run_number,
  cs.run_status, cs.run_completed_at, cs.current_step, cs.total_steps,
  cs.last_activity, cs.lifecycle, cs.pending_gate_review,
  cs.pending_shell_verification, cs.tenant_id, cs.organization_id,
  cs.workspace_id, cs.updated_at,
  (SELECT MAX(started_at) FROM execution_records er WHERE er.session_id = cs.session_id) AS last_execution_at,
  (SELECT er.error_message FROM execution_records er
     WHERE er.session_id = cs.session_id AND er.error_message IS NOT NULL
     ORDER BY er.started_at DESC LIMIT 1) AS last_error
FROM chain_sessions cs;
```

**Files**:

- `server/src/infra/database/sqlite-engine.ts` — schema + view (bump `SCHEMA_VERSION` to 16)
- `server/src/modules/chains/manager.ts:306-332` — `syncToSessionTable()` writes columns instead of JSON-stringifying
- `hooks/lib/db_reader.py` — read columns directly instead of `json.loads(row['state'])`

**Decision needed**: Drop the redundant `state` JSON column entirely, or keep it for fields not yet promoted (e.g., full step results)?

- **Drop it** (recommended): all hook-relevant fields become columns. Cleaner.
- **Keep it**: only if hooks need other fields the columns don't expose (none currently).

**Tests**:

- Hook integration test reading active chain state — verify column reads return same values as JSON parsing did
- `compact-recovery.py` test — verify chain reminder still renders correctly
- Manager persistence round-trip test

**Risk**: Medium. Hook contract change — Python reads must update simultaneously with TS writes. SCHEMA_VERSION bump triggers DB rebuild, so no migration logic needed.

**Effort**: ~3 hours (schema + writer + reader + tests).

---

## Phase 3: Eliminate dual-write — make `chain_sessions` derived only on read (#2)

**Pre-requisite**: Phase 2 complete (columns promoted).

**Problem**: Every `persistSessions()` writes the same data twice:

1. `chain_run_registry` — full blob (SSOT, used at startup)
2. `chain_sessions` — filtered projection (used by hooks for indexed query)

Both must succeed atomically or state diverges.

**Three options, ordered by risk**:

### Option 3A: Keep dual-write, label it correctly (lowest risk)

- Document `chain_sessions` as a **read-optimized projection of `chain_run_registry`**
- Wrap both writes in a single transaction (currently the per-row sync has its own transaction but isn't atomic with the blob save)
- Rename `syncToSessionTable()` → `projectToHookView()` to reflect intent
- **No semantic change, just clarity**

### Option 3B: Drop blob writes, normalize fully (highest cleanup)

- Remove `chain_run_registry` table entirely
- Move `runMapping`, `baseRunMapping`, `runToBase` to dedicated tables:
  ```sql
  CREATE TABLE chain_run_mapping (chain_id TEXT, session_id TEXT, PRIMARY KEY (chain_id, session_id));
  CREATE TABLE chain_base_mapping (base_chain_id TEXT, run_chain_id TEXT, PRIMARY KEY (base_chain_id, run_chain_id));
  ```
- Move `stepStates` Map to a per-step row in `execution_records` (already exists)
- `loadSessions()` reads from `chain_sessions` + mapping tables instead of the blob
- **Eliminates the redundancy entirely, but biggest refactor**

### Option 3C: Drop per-row table, hooks parse blob (lowest cleanup, simplest)

- Remove `chain_sessions` entirely
- Python hooks `json.loads()` the blob and filter active sessions in Python
- Loses the indexed query benefit — hook reads scan all PID rows
- **Not recommended** — hook performance matters more than schema purity

**Recommendation: Option 3A first** (rename + atomic transaction), defer Option 3B until you have a separate driver for it (e.g., adding a "list all my chains across PIDs" query that needs the per-row index). The blob is fine as SSOT; the projection is fine as a derived hook view; the redundancy is conceptual, not wasteful.

**Files (Option 3A)**:

- `server/src/modules/chains/manager.ts` — wrap `runRegistry.save()` + `syncToSessionTable()` in one transaction
- File header docstring on `chain_sessions` table in `sqlite-engine.ts` — mark as derived
- Update `MEMORY.md` "Hook Chain Enforcement: PID-Based Isolation" entry to reflect SSOT

**Tests**:

- Atomic write test: simulate failure between blob save and per-row sync, verify rollback
- Existing tests should pass

**Risk (Option 3A)**: Low. Same data, same writes, just transactional.

**Effort (Option 3A)**: ~2 hours.

---

## Phase 4: Consolidate 5 KV-blob tables into one `kv_state` table (#1)

**Problem**: `framework_state`, `gate_system_state`, `argument_history`, `chain_run_registry`, `resource_hash_cache` have **identical schemas**. Five tables doing the work of one.

**Target state**:

```sql
CREATE TABLE kv_state (
  scope_id TEXT NOT NULL,           -- continuity scope (workspace_id || org_id || pid || 'default')
  organization_id TEXT,
  workspace_id TEXT,
  key TEXT NOT NULL,                -- 'framework' | 'gates' | 'arg_history' | 'chain_runs' | 'resource_hashes'
  state TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (scope_id, key)
);

CREATE INDEX idx_kv_state_workspace ON kv_state(workspace_id);
CREATE INDEX idx_kv_state_organization ON kv_state(organization_id);
CREATE INDEX idx_kv_state_key ON kv_state(key);
```

5 tables + 6 indexes → 1 table + 3 indexes.

**Migration approach**:

1. **Extend `SqliteStateStoreConfig`** to accept a `key` field:

   ```ts
   interface SqliteStateStoreConfig {
     tableName: string; // existing — table name
     key?: string; // new — discriminator if using shared kv_state table
     stateColumn?: string;
     defaultState: () => unknown;
   }
   ```

2. **Update `SqliteStateStore<T>`** internal queries:
   - When `config.key` is set, use `WHERE scope_id = ? AND key = ?` instead of `WHERE tenant_id = ?`
   - When `config.key` is unset, use legacy table-per-store mode (backward compat for non-blob tables like `chain_sessions`)

3. **Update each KV-blob store** to use the shared table:

   ```ts
   // FrameworkStateStore
   new SqliteStateStore<FrameworkState>(db, {
     tableName: 'kv_state',
     key: 'framework',
     defaultState: () => ({ ... }),
   });
   ```

4. **Bump `SCHEMA_VERSION`** to 17 — drop the 5 old tables, create `kv_state`, no data migration (DB is ephemeral).

5. **Update `chain_run_registry` consumer** (run-registry.ts) — `kv_state` row with `key='chain_runs'`.

**Cross-language impact**:

- `hooks/lib/db_reader.py` `_load_from_run_registry()` queries `chain_run_registry` — update to query `kv_state WHERE key = 'chain_runs'`
- This is the **only Python consumer** of the KV-blob tables (others are TS-only)

**Files**:

- `server/src/infra/database/sqlite-engine.ts` — schema (drop 5 tables, add 1)
- `server/src/infra/database/stores/sqlite-store.ts` — add `key` discriminator
- `server/src/infra/database/stores/interface.ts` — extend config type
- `server/src/engine/frameworks/framework-state-store.ts` — pass `key: 'framework'`
- `server/src/engine/gates/gate-state-store.ts` — pass `key: 'gates'`
- `server/src/modules/chains/argument-history-tracker.ts` — pass `key: 'arg_history'`
- `server/src/modules/chains/run-registry.ts` — pass `key: 'chain_runs'`
- `server/src/infra/database/resource-indexer.ts` (or wherever resource_hash_cache is written) — pass `key: 'resource_hashes'`
- `hooks/lib/db_reader.py` — update fallback query

**Tests**:

- Each state store integration test (framework, gates, etc.) — verify writes/reads work through shared table
- Scope isolation test — verify `key='framework'` for scope A doesn't leak to scope B
- Hook fallback test — verify `_load_from_run_registry` finds chain runs in `kv_state`

**Risk**: Medium. Touches every state store consumer. Mitigated by SCHEMA_VERSION bump (no migration logic) and existing tests.

**Effort**: ~5 hours (schema + store + 5 consumers + Python hook + tests).

---

## Phase 5: Review `resource_changes` ↔ `version_history` overlap (#5)

**Problem**: Both track resource modifications. `resource_changes` is an event log (operation + hashes); `version_history` is a snapshot store (full content + diff_summary).

**Investigation step**: Determine actual usage patterns.

- `grep -rn "FROM resource_changes\|FROM version_history" server/` — find readers
- Are both tables being read? By what?
- Is there a use case where `resource_changes` exists without a corresponding `version_history` snapshot? (e.g., delete operations might log to changes but have no version snapshot)

**Likely outcomes**:

- **If overlap is artificial**: derive `resource_changes` from `version_history` (timestamp, version diff = event)
- **If both have distinct readers**: keep both, document the boundary in schema comments
- **If `resource_changes` is unused**: drop it

**Files to check**:

- `server/src/infra/database/resource-indexer.ts` — likely writer
- Any rollback/history MCP tool actions

**Defer recommendation**: This is the lowest-impact redundancy and not in any hot path. Address only if Phase 4 reveals it's also a candidate for consolidation, or if a feature request needs to combine the two.

**Effort**: ~2 hours investigation + variable cleanup.

---

## Total effort estimate

| Phase                             | Effort   | Risk   | Schema bump    |
| --------------------------------- | -------- | ------ | -------------- |
| 1: ChainRunRegistry consolidation | 1h       | Low    | No             |
| 2: Promote columns                | 3h       | Medium | Yes (16)       |
| 3A: Atomic dual-write             | 2h       | Low    | No             |
| 4: KV-blob consolidation          | 5h       | Medium | Yes (17)       |
| 5: changes/version review         | 2h+      | Low    | Maybe          |
| **Total (excluding 5)**           | **~11h** |        | 2 schema bumps |

---

## Validation gates

After each phase:

```bash
cd server
npm run typecheck && npm run lint:ratchet && npm test
npm run validate:arch
```

After Phase 2 and Phase 4 (Python hook impact):

```bash
# Manual hook smoke test
cd server && npm run start:stdio &
# Trigger a chain in Claude Code, then /compact, verify recovery hook fires
```

After all phases:

```bash
npm run validate:all
```

---

## Open questions

1. **Phase 2 — drop `state` JSON column entirely?** Recommended, but check if any consumer reads fields that aren't promoted to columns.
2. **Phase 3 — Option 3A or 3B?** 3A is safe and labels the intent. 3B is the "real" fix but bigger. Decide based on whether you want a follow-up driver (cross-PID chain queries) or are happy keeping the projection.
3. **Phase 4 — keep `kv_state` discriminator-based or split by key into separate tables once schema is shared?** Discriminator-based is simpler but creates a "god table." Splitting later is easy.
4. **Phase 5 — defer or include?** Defer recommendation stands unless investigation reveals a quick win.

---

## Memory updates after completion

Update `MEMORY.md` "Key Architecture Insights":

- Replace "Hook Chain Enforcement: PID-Based Isolation" with new SSOT description
- Update "SQLite: node:sqlite (Native, No WASM)" with `kv_state` table
- Bump SCHEMA_VERSION reference to 17
