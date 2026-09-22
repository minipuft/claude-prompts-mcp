<!-- Deep reference for .claude/rules/sqlite-persistence.md. The rule owns activation and
critical constraints; this document owns the table map, history, and procedures. -->

# SQLite Persistence Architecture

**Declared table properties over inferred ones; the contract module over this file.**

`server/src/infra/database/table-contracts.ts` is the SSOT for owner, posture, scope, and
retention. This file is the orientation map and the traps — when the two disagree, the contract
module wins and this file is stale.

## The Map (12 declared tables + 2 views)

Not 11, and not 13. `tenants` was deleted at v19 (F10); `chain_run_registry` was deleted at v22
(P3 Tier 4), replaced by the two per-row tables below; `objects` and `version_entries` were added
at v29. The schema is at v30. SQLite auto-creates `sqlite_sequence` for
any table declaring `AUTOINCREMENT`; it is never declared in `applySchema()` and is excluded via
`SQLITE_INTERNAL_TABLES`. A startup assert written against a raw `sqlite_master` count throws on
every boot.

| Table                   | Owner                                               | Posture     | Scope           |
| ----------------------- | --------------------------------------------------- | ----------- | --------------- |
| `schema_version`        | `sqlite-engine.ts`                                  | derived     | none            |
| `chain_sessions`        | `modules/chains/manager.ts`                         | derived     | run-owner-pid   |
| `kv_state`              | `stores/sqlite-store.ts`                            | ephemeral   | workspace       |
| `resource_index`        | `resource-indexer.ts`                               | derived     | none            |
| `skills_sync_manifests` | `modules/skills-sync/service.ts`                    | **durable** | client-scope    |
| `version_history`       | `modules/versioning/version-history-service.ts`     | **durable** | workspace       |
| `objects`               | `cli-shared/object-store.ts`                        | **durable** | workspace       |
| `version_entries`       | `cli-shared/object-store.ts`                        | **durable** | workspace       |
| `resource_changes`      | `observability/tracking/resource-change-tracker.ts` | derived     | workspace       |
| `chain_runs`            | `modules/chains/run-registry.ts`                    | ephemeral   | run-owner-pid   |
| `chain_run_nodes`       | `modules/chains/run-registry.ts`                    | ephemeral   | run-owner-pid\* |
| `execution_records`     | `modules/chains/execution-record-store.ts`          | ephemeral   | workspace       |

\* `chain_run_nodes` declares `scope: 'run-owner-pid'` in the contract but carries no scope
columns of its own — a node row belongs to exactly one `chain_runs` row via `session_id`, and
that parent row already owns `run_owner_pid`/`workspace_id`. The scope is real, carried
transitively through the parent, not duplicated. `ScopeKind` has no vocabulary for "scoped via
parent" distinct from "owns this scope directly" — both read the same label in the table. Treat
the two chain-run tables as one storage unit for scope purposes; do not add scope columns to
`chain_run_nodes` on the theory that the contract's label implies they exist.

Views: `v_execution_status` selects `FROM chain_sessions`, which is PID-deleted at cleanup, so it
structurally cannot observe a completed run. Until v20 it could not observe an in-progress one
either — it json_extracted `$.state.currentStep` while its only writer emitted `currentStep` at the
top level, so both step columns read NULL on every row and the hook's primary read path returned
nothing for every input (F12). `v_execution_history` (added v17) reads
`execution_records` directly and can — but **nothing reads it**. Measured 2026-08-11: the
`system_control execution_history` action, which its contract entry names as its reader, calls
`ExecutionRecordStore.queryRecent()` against the raw table; `rg` across `src/` and `hooks/` finds
only the DDL and the contract entry. Do not add columns to it on the theory that its declared
reader will pick them up — that is how this table produced value-dead columns twice. Its
`VIEW_CONTRACTS` entry carries a `finding` saying so.

`execution_records` gained five run-telemetry columns at v21 — `steps_planned`, `gates_fired`,
`gate_retries`, `unknowns_opened`, `unknowns_closed`. They are populated **only on terminal rows**,
by the two terminal-record writers (`21-formatting-stage.ts`, `prompt-execution-pipeline.ts`), and
are NULL on per-step `working` rows. Read that partial population as intentional-by-row-type, not
as either precedent already documented here: unlike `workspace_id` these have a writer that binds a
real value, and unlike `gate_verdicts_json` that writer runs. They are record-only — nothing scores
or routes on them, so a query finding them all NULL means the run never terminated, not that the
column is dead.

`chain_run_nodes` gained two columns at v23 for adaptive mutation (P4) — `origin`
(`'planned' | 'inserted'`) and `origin_unknown_id` (nullable). `origin` is `TEXT NOT NULL` with
**no DDL DEFAULT**, deliberately: `validate:no-phantom-columns` exempts every defaulted column, so
a default here would make the column invisible to the one gate built to catch a dropped writer —
and if a future edit ever did drop it from the INSERT list, a default would silently paper over
that with `'planned'` on every row, the same value-dead shape `execution_records` has already
produced twice. Nothing is lost by omitting it: the table has one declared writer and the bump
recreates it (ephemeral), so no pre-v23 row can arrive missing the column. `origin_unknown_id`
records WHICH declared unknown caused an insertion — `origin` alone answers only the run-wide
insertion count, never "has this unknown id already had its insertion", so both are real columns
rather than one encoding the other (an id-in-the-node-id encoding was rejected: `mintInsertionId`'s
slugify is lossy and not a decodable inverse). NULL on planned rows is partial population BY ROW
TYPE, the same reading as the v21 columns above, not a value-dead column. The skip path has no
symmetrical column: `markNodeSkipped`'s triggering unknown id is logged only, never persisted —
skips are uncapped in v1 (each requires its own declared target, which is its own bound) and
nothing reads it back.

`execution_records` gained two more terminal-row columns at v23, `nodes_inserted` and
`nodes_skipped` — the adaptive mutation policy's audit counters. They extend the same v21
telemetry object rather than adding a second one; both terminal-record writers already spread that
whole object into their row, so the both-writers invariant held structurally with no per-writer
edit required.

`execution_records.delegation_skipped` became `handoff_evidence TEXT` at v30 — a REPLACEMENT, with
no dual-write window. The retired boolean was a projection of a four-valued fact: it could only be
bound for a delegated step that also carried gate text, so an ungated delegated step recorded NULL,
which is the same spelling as "not delegated". The text column records the REASON a delegated
step's resume was or was not acceptable — `'ok' | 'trailer' | 'node-line' | 'node-mismatch'`, the
enumeration `HANDOFF_EVIDENCE_REASONS` (`shared/types/handoff-evidence.ts`) owns and the column's
`CHECK` repeats — for EVERY delegated step and in both evidence modes. NULL means the row
describes no capture: the step was not delegated, or the row is a render, a terminal, or a
verdict-time row (below). Its writer is a THIRD row type, distinct from the per-step and
terminal writers above: the capture-time `completed` row `StepCaptureService` appends when a chain
resume captures real step output. Nullable with **no DDL DEFAULT**, for the reason
`chain_run_nodes.origin` has none.

**A verdict submitted on its own call is a FOURTH row type** (P4.86), also written by
`StepCaptureService` — `ledgerSubmittedVerdict`. The server's retry prompt asks a client to answer
a step and submit its verdict on a later call, and in that shape the step's `completed` row is
already written, so `captureStep` returns early and no append fired at all: the verdict and its
per-gate entries reached no record. The verdict now gets its own row for the same step, APPENDED —
the earlier row is left byte for byte as it was, because this table is append-only per step and
that row is the true record of what the step produced and when. A reader that wants the current
picture resolves the LATEST record for the step, which is what `v_execution_history` already does
per session through `MAX(execution_id)` over monotonic ULIDs. The row's `status` is the step's
lifecycle as the call leaves it — `completed` when the verdict cleared the review,
`input_required` (with an `input_required_json` naming the gate and the attempt) when it did not —
and `gate_verdicts_json` carries the per-gate entries the submission resolved against the gates
the review advertised. A verdict submitted with NO pending review (the deferred path) carries no
per-gate entries: the numbered gate list a `[n] PASS` refers to is rendered from
`pendingReview.gateIds`, so without a review the server never advertised one to index into.

No migration was owed and none was written: `execution_records` is `ephemeral`, so the bump drops
and recreates it, and no row written under the old name can reach v30 to be read under the new one.
`DROPPED_ON_THIS_BUMP` stays empty and `DROPPED_AT_VERSION` does not move. Seven test harnesses
hand-write this table's DDL rather than booting the engine;
`tests/unit/infra/database/execution-records-ddl-parity.test.ts` enumerates them by shape and fails
when one drifts from the engine's column set — which is how a copy left declaring the retired
column was found after a clean textual merge.

## Four Tables Are Durable — A Schema Bump Must Not Destroy Them

`objects` and `version_entries` joined this list at v29; the reasoning below is why the
classification, not the DDL, is the risky part of that bump.

`version_history` holds rollback snapshots that nothing regenerates. `skills_sync_manifests` drives
orphan detection, and `applySyncPrune` deletes directories listed in it — losing it turns a prune
into either a no-op or a deletion of the wrong thing.

**One prune, one bound, both writers.** `maxRowsPerResource: 50` in the contract is the bound an
unconfigured workspace gets; `versioning.maxVersions` replaces it. Both writers trim through
`pruneVersionHistory` (`cli-shared/version-history-rows.ts`), which keeps the NEWEST N and takes
the bound as an argument — it resolves no default of its own. The server passes its resolved
`VersioningConfig`; `cpm` passes `resolveConfiguredMaxVersions(workspace)`, which reads the
workspace config document through the same reader `cpm config` uses, honouring both the 5.0
`versioning.maxVersions` and the 4.x `versioning.max_versions` spelling. Until 2026-09-21 the CLI
bound a hardcoded 50 into every request, so a workspace set to keep three kept three after an MCP
edit and fifty after a `cpm rollback` — against one file. `retention.ts` enforces no
`maxRowsPerResource` for exactly this reason: a generic sweep would know only the declaration.

**Durable is not unbounded: the rows are reclaimed by the delete of the resource they describe.**
Its declared retention is per-resource (`maxRowsPerResource`), which bounds a LIVE resource's
history and says nothing about a dead one's — and until the four `resource_manager` delete handlers
called `VersionHistoryService.deleteHistory`, nothing did. Rows of a deleted resource stayed
forever: unreachable, because every reader resolves the resource before the row, and inherited by
the next resource created under that id. Both delete surfaces purge now, over one subtree predicate
(`RESOURCE_SUBTREE_MATCH`, `modules/versioning/history-key.ts`) so a chain takes its steps'
`chain/step` rows with it. The residual leak is cross-surface, not per-surface: rows written under a
tenant id the other surface does not resolve are not reached by its delete.

`ensureSchema()` snapshots durable rows → drops → `applySchema()` → restores by intersecting old
columns with new. **Do not "optimize" this into skipping durable tables during the drop.**
`applySchema()` uses `CREATE TABLE IF NOT EXISTS`, so a table that is never dropped is never
recreated and its DDL freezes permanently.

Adding a `NOT NULL` column with no default to a durable table makes the restore throw, naming the
table. That is intended: the change needs a real migration.

## The Object Store Is Additive — Schema v29

`objects` holds raw file bytes keyed `(tenant_id, hash)`; `version_entries` is the manifest, one
row per `(version row, path)`, and it IS the tree. `version_history.tree_hash` is a nullable cache
over that manifest — the manifest is authoritative — and NULL means the row is projection-only.

`version_history.tree_origin` records which root class the recorded bytes were read FROM, using
the file-set enumerator's vocabulary: `primary` | `overlay` | `bundled` | `unknown`. The enumerator
(`shared/utils/resource-file-set.ts`) stays the SSOT — there is no `CHECK` constraint here, because
a second copy of a vocabulary is a second thing to keep in step. It exists because a restore is not
root-agnostic: bytes recorded from the **bundled** catalog restore into the workspace as a NEW
override, which is a different act from restoring a workspace file over itself, and the preview has
to say so. It cannot be derived at restore time — roots are resolved per process, so a row written
under one root layout would be re-classified under another. `tree_origin` is NULL exactly when
`tree_hash` is; the two are one fact and ship in one schema version for that reason.

### The config file is a checkpointed resource too

`version_history.resource_type` is a bare `TEXT` with no `CHECK`, and since ruling R53 it also
carries the literal `'config'`, with `resource_id = 'config'`. No schema change was needed — the
same widening `'category'` took at P4.7.

Four things make it different from the four resource types, and all four are deliberate:

- **Its `tenant_id` is not a workspace scope.** It is `config:` plus a 16-hex digest of the config
  file's symlink-resolved directory (`shared/utils/config-scope.ts`), because config is the only
  checkpointed thing whose writers do not share a working directory: `cpm` runs from the operator's
  cwd and `system_control … persist: true` from the server's install path, and a cwd-derived scope
  made those two tenants for one file. Every reader and writer calls that one function; a config
  request reaching the generic workspace guess is refused by name, because the guess's correction
  keys on `resource_type`/`resource_id` and every workspace's config shares the same pair — it
  would serve another project's history. Two workspaces on one `state.db` are still two
  directories, so they are still isolated. Rows written before this rule (between #347 and the fix,
  both unreleased) are not re-keyed: the old tenant does not identify a config FILE and the rows
  carry only a basename, so a re-key has no derivable target. The next write bridges the current
  file as a fresh version 1.

- **It is not a `ResourceType`.** Only `cli-shared/version-history-types.ts`'s union gained the
  literal. The published `resource_manager` union did not: config stays read-only over MCP, as it
  has been since #312, and `cpm config history` / `cpm config rollback` are the whole surface. The
  versioning domain's own union did not either, because it keys `resourceFileSet`'s entry-filename
  table and config has no resource root, no entry filename and no loader to enumerate.
- **Its `snapshot` is not a projection.** It holds `{filename, size, hash}` and nothing else. There
  is no `SnapshotContract` for config, because the file's BYTES are the version — a `.jsonc`
  document's comments are part of what an operator is restoring, and no projection carries them.
- **A row with no tree is therefore unrestorable, and says so.** Every other type degrades to its
  projection when `tree_hash` is NULL; config refuses by name instead, because falling back would
  mean inventing a document. That asymmetry is the price of storing nothing but a digest, and it is
  checked rather than documented (`cli-shared/config-restore.ts`).

Which file gets recorded is the file that was written — `resolveConfigPath` on the CLI side,
`configManager.getConfigPath()` on the server side. There is no overlay layering for config: one
path is resolved, it is both what was read and what is written back, so a restore's destination is
never a different tree and `tree_origin` is always `primary`.

### What writes a tree, and when

`cli-shared/object-store.ts` is the sole writer of both tables. It lives there, rather than beside
the server's versioning service, because both writers of `version_history` must produce the SAME
`tree_hash` for the same files and `cli-shared/` is the only layer the server and `cpm` can share.
It opens no transaction of its own: every statement runs inside the caller's existing
`BEGIN IMMEDIATE`, in foreign-key order — objects, then the manifest, then the row's `tree_hash`
and `tree_origin`. That is invariant WRITE-1: an object insert is always in the same transaction as
the reference that justifies it, so a crash between them leaves neither.

**The file READS are outside that lock, and `recordTree` is synchronous.** `readResourceTree` reads
and hashes the bytes before the caller takes the lock; `recordTree` then runs SQL only. Nothing
read needs the lock — objects are content-addressed, so a file that changes between the read and
the commit produces a different tree rather than a wrong one — and holding a write lock on a file
two processes share across disk I/O blocks the other one for as long as the disk takes. It is also
what lets `cpm` share the recorder at all: that path is a fully synchronous `DatabaseSync`.

The files it stores are the ones `resourceFileSet` enumerates, and it never enumerates for itself —
one answer, shared by the recorder and any later restorer. Finding the resource from a type and an
id is a third party's job again: `runtime/resource-roots.ts` builds a `ResourceFileLocatorPort` from
`resolveResourceRoots` and the composition root threads it into each tool's `VersionHistoryService`,
so root precedence keeps its one owner.

**A row that records no tree is a degradation, not a failure.** An over-limit file (1 MiB per file,
8 MiB per resource), an unreadable one, a resource no root holds, or a service with no locator
leaves `tree_hash` NULL and emits one `warn` naming the resource and the reason. The version row is
the thing nothing regenerates; refusing to write it because its bytes were too large would trade a
degraded rollback for a lost version. A SQLite failure is the other case and propagates, rolling the
caller's transaction back.

**A row gets a tree exactly when the bytes on disk at record time ARE that row's state**, and only
its caller knows that — so the answer is a per-row parameter, never a match against the bridge
row's description text, which is presentation deciding durability.

On the SERVER, `recordEditResult` appends the prior live state and then the produced state, and
BOTH appends run at commit time, after the produced files are on disk. So the produced row
qualifies and the bridge row does not: a tree on the bridge row would describe the produced bytes
under a row whose snapshot is the prior state.

**`cpm rollback` reaches the same rule by interleaving the write between its two rows.** It used
to record both rows and restore the files afterwards, which left the file it produced described by
no row at all: measured 2026-09-21, `Rollback to v1` carried `tree_hash` NULL while the bytes on
disk hashed to something nothing had recorded, so `cpm history` listed a state a later rollback
could not reproduce. `rollbackVersion` now takes the restore as a callback
(`RollbackRestore.apply`) and drives it between the two appends: the prior-state row is written
while the disk still holds the prior bytes, and the produced row once the restored bytes are
there. Both rows carry the tree of the state they describe, and neither carries the other's.

That ordering also gives the two rows the server's atomicity. `recordCheckpointedWrite`
(`cli-shared/checkpointed-write.ts`) runs the restore and the produced append as the `mutate` and
`commit` steps of the same `ResourceMutationTransaction` every server processor uses, so a failed
restore claims nothing and a failed record puts the files back byte-identical. The prior-state row
is deliberately OUTSIDE that transaction: it describes a state that genuinely existed, which is
true whether or not the write that follows succeeds — and after a rolled-back write the files are
once again exactly what it describes.

Pinned by `tests/integration/versioning/cli-tree-parity.test.ts` (both rows' manifests, the
already-current case, a failed restore, a failed record, and the command's own wiring) and by
`tests/e2e/cli-rollback-parity.e2e.test.ts`, which drives the BUILT `cpm` binary against the
server's own `state.db` and hashes the files afterwards. The same file asserts that a `cpm` write
and a server write of identical files produce an identical `tree_hash` — one enumerator, one
hasher, one recorder, reached from both sides.

**One projection per resource type, read by both surfaces.** A version row's `snapshot` is a
`SnapshotContract` projection. For every type — prompt, gate, framework and category — what that
projection RECORDS lives in `src/modules/versioning/projections/`, which both `mcp/tools/**` and
`cli-shared/` import;
the tool-layer contracts keep only `restore`, which rebuilds a write model whose type is a tool-layer
one. `cpm rollback` of a gate or a framework therefore records the state it replaced in the same
shape `resource_manager` would, and no longer writes a "Bridge: prior live state" row for a
server-written resource. Until 2026-09-21 it passed the raw YAML map instead — measured on one gate,
`{id,name,description,type,severity,guidanceFile}` against the server's
`{id,name,type,description,guidance}` with the markdown body inline — so the two could never compare
equal and every such rollback bridged.

**The prompt projection joined them on 2026-09-21, and what it cost was bundle, not layering.**
`canonicalPromptSnapshot` takes a loader-RESOLVED prompt (`userMessageTemplate` inlined, where
`prompt.yaml` holds only `userMessageTemplateFile`), so building its input needs the prompt loader.
`cli-shared/prompt-projection.ts` runs `PromptLoader.loadFromDirectories` +
`PromptConverter.convertMarkdownPromptsToJson` — the pair `PromptAssetManager.loadAndConvertPrompts`
runs, used whole rather than reached past, because the WALK is what sets a prompt's `category` from
its folder and `category` is a projected field. Measured: the dev `cpm` bundle went 918,220 B →
986,048 B, **+66.2 KB**, against the 1,000,000-byte `DEV_BUNDLE_BUDGET_BYTES` (13,952 B of
headroom); the shipped minified budget is untouched. Writing a second, YAML-shaped prompt
projection instead was the shape this arc exists to remove: a differently-shaped snapshot can never
hash-compare equal, so every server edit of a `cpm`-written prompt would have bridged forever.

A prompt the loader cannot serve is not recorded as if it had been projected: the row is written
through the same projection over the raw entry file, so the key set and ORDER still match, and the
reply carries a `snapshot_degraded_reason` naming what is missing.

**`cpm create`, `cpm toggle` and `cpm link-gate` record through the same ordering as of
2026-09-21.** A create records the produced state as version 1 with no prior-state row — nothing
existed to bridge, which is the server's own create rule — and a toggle or a gate link records as
an edit, bridging the pre-write state first if it was not already the newest row. All run their
append as the write's `commit`, so a failed record restores every target: for a create that means
removing the directory the transaction captured as absent. They therefore leave a row the server's
next edit does not have to bridge — driven in
`tests/e2e/cli-create-records-a-version.e2e.test.ts` and
`tests/e2e/cli-toggle-records-a-version.e2e.test.ts`, each with an out-of-band-edit twin as the
positive control for the missing bridge row, and in both directions: a `cpm`-created prompt takes
a server edit with no bridge, and a server-written prompt rolls back from `cpm` with no bridge.

**A row's description names the surface that wrote it.** `createRowDescription(surface)` /
`updateRowDescription(surface)` (`modules/versioning/snapshot-contract.ts`) are the one owner, so a
`cpm` row reads `Created via cpm` / `Update via cpm` and a server row is unchanged. They were a
pair of constants that `cpm` reused, which put `resource_manager` on every row `cpm` wrote — in the
one sentence a history is consulted for, and the two surfaces undo differently.

What still records nothing says so rather than staying silent, in `--json` and in the text, with
the reason: a created or toggled style (styles carry no version rows on either surface), and any
write in a workspace with no `state.db` (the CLI never authors that schema). A silent non-record is
the shape this arc removes.
`tests/integration/versioning/cpm-write-records-a-version.test.ts` is the gate that fails the
moment a still-blocked command starts recording, or a recording one stops.

`cpm delete` purges the subtree, `cpm rename` re-keys it, and `cpm move` leaves it alone because a
category move does not change the id a history row is keyed on. Those three are complete, not
missing a row. The whole classification is enumerated from the command registry, with the open
entries stamped, by `tests/integration/versioning/cpm-write-records-a-version.test.ts`: a command
that starts writing resources without a classification fails there, and so does an entry whose
stated blocker no longer holds.

**Losing every object degrades rollback to the projection path; it never loses history.**
`version_history.snapshot` keeps holding the projection every reader already reads, and it is not
retired, not deduplicated into the store, and not backfilled. That is the whole reason a garbage
collector may sit in front of `objects` at all: its miss path is the shipping code. Read any
proposal to retire `snapshot` as a proposal to put a sweep in front of unrecoverable data.

**Objects are keyed per workspace, not globally.** One `state.db` serves every project on the
machine, so a global hash key would make one workspace's blob the storage for another's identical
file. Cross-workspace dedup is what is given up; in exchange no surface exists, even in principle,
on which one workspace could observe that another holds a given byte sequence. `tenant_id` here is
the value the owning `version_history` row carries — resolved once and passed down, never
re-derived in the store.

**The foreign keys are declared, enforced, and now asserted — and the three are different
things.** `rg "foreign_keys"` over `server/src` and `cli/src` used to return nothing, and the
obvious reading of that absence was wrong: `node:sqlite`'s `DatabaseSync` enables foreign key
constraints **by default**, and both openers that WRITE `state.db` are `DatabaseSync`. Measured
2026-09-20 — `PRAGMA foreign_keys` reads `1` on a fresh connection.

Enforcement was therefore inherited from the driver rather than owned by this repository, which is
not a state a v29 invariant may rest on. `STATE_DB_WRITER_PRAGMAS`
(`shared/utils/runtime-state-location.ts`) now carries `PRAGMA foreign_keys = ON` beside the shared
`busy_timeout`, and both writers apply the whole list. **Be honest about what that line proves:
removing the `foreign_keys` line changes no behaviour on this driver, and no test goes red when it
is deleted.** It is an assertion, not a fix — what it buys is that a driver default change, a different Node, or a new
opener written from that list cannot silently withdraw the guarantee.

Every opener of `state.db`, and its foreign key posture:

| Opener                                  | Driver               | Posture                                  |
| --------------------------------------- | -------------------- | ---------------------------------------- |
| `infra/database/sqlite-engine.ts`       | `node:sqlite`        | ON — applies `STATE_DB_WRITER_PRAGMAS`   |
| `cli-shared/version-history.ts` (`cpm`) | `node:sqlite`        | ON — applies the same list               |
| `hooks/lib/db_reader.py`                | `sqlite3`, `mode=ro` | off (driver default); read-only, so moot |

`hooks/lib/hook_state_store.py` and `hooks/lib/verify_active_store.py` open `hooks-state.db` and
`verify-state.db`, which are different files with different schemas.

Two consequences that only show up at a schema bump: `restoreDurableTables` replays
`DURABLE_TABLE_NAMES` in declaration order, so `objects` and `version_entries` must stay declared
**after** `version_history` in `table-contracts.ts` or the restore is refused; and `dropAllTables`
drops in `sqlite_master` order, which reaches `version_history` first and cascades the manifest
empty before either new table is dropped. Both are pinned by
`tests/integration/database/durable-round-trip.test.ts`, which is generated from `TABLE_CONTRACTS`:
it seeds one row in every `durable` table, runs the recreate, requires every row back
byte-identical, and **fails when a durable table has no seed** — so the next durable table anyone
adds is covered by a red run rather than by someone remembering. It also reads the foreign key
edges out of the engine's own DDL and checks the declared restore order against them.

**Do not read enforcement as "the cascade prunes entries for us."** It is still a per-connection
setting, so any opener that turns it off writes into the same file. The startup referential check
is what finds what such an opener left behind.

**Every path that removes rows of `version_history` or `version_entries` also sweeps that tenant's
orphaned objects, in the SAME transaction.** An object is reachable only through
`version_history → version_entries → objects`; nothing enumerates the table and there is no
maintenance pass, so bytes whose last manifest row is gone are unreachable and unreclaimable. The
sweep is `sweepUnreferencedObjects` (`cli-shared/object-store.ts`): `NOT EXISTS` against
`version_entries`, scoped to one `tenant_id`, re-derived every time rather than tracked in a
refcount column a crash could drift. Four callers, and the predicate has to name BOTH tables to
find them all — one of the four deletes no `version_history` row at all:

| Path                                                  | Where                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| prune, on every append (both writers)                 | `pruneVersionHistory`, `cli-shared/version-history-rows.ts`    |
| `deleteHistory`, from the four `handleDelete` bodies  | `modules/versioning/version-history-service.ts`                |
| `cpm`'s `deleteVersionRows`                           | the `delete_history` dispatch, `cli-shared/version-history.ts` |
| the startup referential repair (deletes ENTRIES only) | `SqliteEngine.repairVersionTrees`                              |

The `NOT EXISTS` clause is the guard; the foreign key is the backstop. Both matter and they are not
interchangeable — a sweep relying on the constraint would RAISE on a referenced object and abort
the caller's whole transaction, taking its `version_history` deletes with it.

**A rename is GC-neutral and needs no sweep.** `renameSubtree` re-keys `resource_id`/`version`
only; entries key on `version_row_id` and objects on content, so neither moves. Pinned by
`tests/integration/versioning/object-gc.test.ts`, which compares both tables as one value across a
rename — "rename touches history" otherwise invites a speculative fix.

**No backfill of pre-v29 rows, deliberately.** Materialising a tree from a projection would
fabricate file bytes that never existed on disk, which is worse than a NULL. Old rows keep
restoring the way they always did.

**Downgrade is defined, and it costs fidelity rather than history.** A v28-era server opening a
v29 database snapshots durable tables using ITS `DURABLE_TABLE_NAMES`, which does not contain the
two new tables, so `dropAllTables` destroys every object and entry while `version_history` survives
with `tree_hash` dropped by column intersection. **Lost: byte-exact restore. Not lost: any
history.** No version-floor refusal guards this on purpose — it would turn a recoverable
degradation into a server that will not start. Re-upgrading is repaired by the startup check.

## A Version Number Is an Identity, and Schema v28 Enforces It

`idx_version_history_key` is UNIQUE on `(tenant_id, resource_type, resource_id, version)`. Every
reader of `version_history` selects by version — `getVersion`, `compareVersions`, `rollback` — so
two rows sharing one meant a rollback restored whichever row SQLite reached first.

They could. A resource's history rows survive its deletion by design, so an id can carry history
while nothing serves it, and the CLI's `rename_history` re-keyed a resource onto a new id with a
bare `UPDATE ... SET resource_id`: renaming onto such an id merged two sequences and left two rows
claiming to be v1. The producer moved with the index — a rename now renumbers the incoming rows to
continue after the target's newest version, in one transaction, and a target with no history is
re-keyed with its numbers untouched.

Both writers take the key the same way, and each does it atomically: the newest row and the INSERT
that consumes its number run inside one `BEGIN IMMEDIATE`, because the number read is the number
written back and a second connection committing between the two makes the INSERT land on a stale
maximum.

That one read now answers two questions, which is why it selects the row rather than `MAX(version)`:
what number comes next, and whether this snapshot is the one already stored. When
`hashCanonical(snapshot)` — `shared/utils/hash.ts`, the single identity rule both writers import —
matches the newest row's, no row is inserted and the existing version is returned. The equality
decision sits INSIDE the lock for the same reason the numbering does: decided above the `BEGIN`,
two processes could each compare against a newest row the other was about to replace and each
conclude "unchanged", leaving a real change recorded by neither.

**A stored hash must hash what each writer stores, not one uniform projection.** Three of the four
`SnapshotContract`s canonicalise through `canonicalizeSnapshot`; the prompt contract deliberately
does not, because `id` and every `SNAPSHOT_PRESERVED_FIELDS` member sit outside its
`projectedFields` and would be dropped — re-bridging every prompt row already on disk. Anything
that later persists a `snapshot_hash` column has to take each writer's own stored text as its
input, or prompts and the other three resource types will disagree about what a snapshot IS.

Until then the two writers disagreed about what "unchanged" meant. The server used
`isDeepStrictEqual` and let the answer gate only the BRIDGE row, inserting the produced state
regardless; the CLI compared `JSON.stringify` output, which is key-order sensitive, so a snapshot
the server had written read as different data to `cpm`. One rule, imported by both, is what makes
their rows interchangeable.
`DatabasePort.transaction(fn, 'immediate')` is the shared helper; the default stays `deferred`,
which takes no lock until the first write and is correct only for a body that reads OR writes. No
retry loop — a contender waits on the lock, and how long it waits is `busy_timeout`.

**The predicate for which mode a transaction needs is "does it read before its first write".** Only
then is there a lock to upgrade, and an upgrade race is the one `busy_timeout` cannot rescue, since
waiting does not resolve it. Measured rather than assumed: the statements
`ChainManager.persistSessionsOrThrow` issues begin `DELETE, DELETE, SELECT`, so it holds the write
lock before it reads anything and is correct as `deferred` — `tests/integration/database/
transaction-lock-mode.integration.test.ts` records that order and fails if a `SELECT` moves to the
front. `skills-sync`'s manifest batch opens with a `DELETE` for the same reason. An IMMEDIATE lock
costs readers nothing: under WAL a reader still sees the last committed snapshot, which is what lets
the Python hooks keep reading while the server writes.

**Both connections set `busy_timeout` from one constant**, `STATE_DB_BUSY_TIMEOUT_MS` in
`shared/utils/runtime-state-location.ts`, beside the two path segments and for the same reason: the
CLI opens its own connection and cannot import `runtime/`, so two hand-typed values would drift and
the pair would disagree about how patient this file is. Unset, a connection takes SQLite's default
of 0 and loses every race outright — WAL lets readers and one writer coexist, it does not make two
writers coexist, and this file has three openers. The Python hooks are the third; they open
read-only and inherit `sqlite3.connect`'s own 5-second default, the same number by coincidence
rather than by contract, so changing the constant means checking `hooks/lib/db_reader.py` too.

**The two lines of `STATE_DB_WRITER_PRAGMAS` are not equally inert, and until 2026-09-21 nothing
said so.** Deleting the whole loop from the CLI's `openStateDb` left 501 tests green, which read
as "the list is decorative" — true of `foreign_keys` on this driver, false of `busy_timeout`, and
the two were indistinguishable. `tests/integration/database/cli-state-db-busy-timeout.test.ts`
closes that half behaviourally: a child process holds `BEGIN IMMEDIATE` for 300 ms and a real CLI
entry point (`deleteVersionRows`, reached by `cpm delete`) must WAIT for it and succeed, with a
zero-patience connection against the same held lock as the positive control. `openStateDb` is
private and closes its connection before any caller could read a pragma off it, so an observable
probe is the only honest one.

v28 is the worked example of a **real migration** on a durable table. `ensureSchema()` renumbers
colliding rows between the snapshot and the restore (`renumberDuplicateVersionHistory`,
deterministic by `created_at` then `id`), keeping every row and every chronology, and logs one line
with the count. Without it the restore would hit the new index and abort startup. There is no dual
write and no flag: a v28 database cannot produce a duplicate, so the migration is a no-op forever
after, and it needs no `DROPPED_ON_THIS_BUMP` entry because nothing is discarded.

## `tenant_id` Means Three Things — Two of Them Are Not a Workspace

The PID meaning got its own name at v20. `chain_sessions` and `chain_runs` now declare
`run_owner_pid`, so no column name carries both a run owner and a workspace.

| Value               | Column          | Tables                                                          | Consequence                                             |
| ------------------- | --------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| Server PID          | `run_owner_pid` | `chain_sessions`, `chain_runs`                                  | Row dies with the process — a session key, not a tenant |
| Workspace id        | `tenant_id`     | `kv_state`, `version_history`, `resource_changes`               | Genuine isolation (Tier 4)                              |
| Literal `'default'` | `tenant_id`     | `execution_records`, and any table with no workspace configured | No isolation                                            |
| Config file id      | `tenant_id`     | `version_history` rows with `resource_type = 'config'`          | `config:<digest>` — the file's directory, not a scope   |

Three meanings share `tenant_id`, and a filter written against the wrong one is still not
type-detectable — but the two that were furthest apart no longer collide, and the config one that
joined at P4.109 is distinguishable at a glance, since nothing else in this column contains a
colon. The rename was a clean
break with no dual-write: zero downstream readers were measured across `minipuft-plugins`,
`gemini-prompts` and `opencode-prompts`, and both tables are `derived`/`ephemeral` with rows
DELETEd per-PID, so no old-format row could survive the bump that renamed them. `run_owner_pid`
also carries **no `DEFAULT`** — a run owner is known at every write site, and a default of
`'default'` would make the column name a lie for exactly the rows hardest to explain.

## Workspace Isolation (Tier 4 — writers now conform)

Every table that declares scope columns also populates them. Until Tier 4 only `kv_state` did, and
a startup migration backfilled the rest on the next boot — a treadmill against writers that never
stopped emitting NULLs. `applyIdentityScopeMigration` was deleted once each writer conformed:

| Table              | How its scope arrives                                                              |
| ------------------ | ---------------------------------------------------------------------------------- |
| `kv_state`         | `SqliteStateStore` — PRAGMA-derived column list                                    |
| `resource_changes` | `defaultScope` on the tracker; the watcher fires with no request to thread         |
| `chain_sessions`   | `defaultScope` on `ChainSessionStoreOptions`, bound in `projectToHookView`         |
| `chain_runs`       | merged `runScope` — PID decides `run_owner_pid`, workspace fills the scope columns |
| `chain_run_nodes`  | none of its own — scope travels via `session_id` to its `chain_runs` parent row    |
| `version_history`  | scope injected into the service; all nine query sites bind it together             |

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

There are also two other database files: `hooks-state.db` (Python) and `verify-state.db`, which the
shell verification stage writes in `loop:true` mode and the Python Stop hook reads. It lives beside
`state.db` in the runtime state directory — `ConfigManager.getRuntimeStateDirectory()`, never the
package directory — and the hook finds it from the `state.db` it locates.

**Every `SqliteEngine.getInstance` call names its `dbPath`.** The path is required and has no
package-relative default; the composition root resolves it once through
`PathResolver.getStateDatabasePath()`, and the engine refuses a later caller that names a different
file. Code outside `runtime/` reads the same path from `ConfigManager.getStateDatabasePath()`
rather than joining `state.db` itself. `validate:db-claim-order` fails on a call without a
`dbPath`, and on any `runtime-state` or `state.db` path segment composed outside
`runtime/paths.ts`.

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

**Exception hygiene is enforced**: both gates route accepted exceptions through
`scripts/lib/exception-hygiene.js`. A satisfied, unreachable, or malformed exception fails the gate;
every entry needs a non-empty `closedBy`. Re-read exception findings when widening a scanner or
changing a writer because the observed source surface is part of the exception contract.

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
