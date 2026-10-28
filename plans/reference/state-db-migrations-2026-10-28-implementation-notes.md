---
title: "state.db migrations — implementation notes"
date: 2026-10-28
status: backlog
tags: []
---

# state.db migrations — implementation notes

## Rulings

| Id  | Date       | Ruling                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | 2026-10-28 | Upgrades from below v35 are refused. Owner chose "proceed" on the recommendation that listed the floor.                                                                                                                                                                                                                                                                                            |
| Q2  | 2026-10-28 | Planner ruling: migration steps are pure transforms over the durable snapshot, not live ALTER steps as first described in chat. The engine already holds every durable row in memory between snapshot and restore, so DDL stays single-sourced in `applySchema` and the three v36 primary-key changes need no table rebuild. Reported to the owner at plan hand-off; reversible before PR1 merges. |
| Q6  | 2026-10-28 | Owner: "lets proceed with both PRs" — push both branches and open both PRs; merge waits for the owner.                                                                                                                                                                                                                                                                                             |

## Findings

- F1 (2026-10-28): `prompt_engine` dropped every value sent through `inputs` on a `>>a --> >>b` chain command: the run started with `feature` empty and no refusal, although `feature` is required. Inline arguments in the command string arrived intact. Run `chain-implementation_plan#1`, aborted.
- F2 (2026-10-28): the live `execution_records.organization_id` holds the workspace name (114/30/14 rows per workspace); every other table's `organization_id` is NULL. Row 4.3 locates the writer.
- F3 (2026-10-28): the shared checkout's HEAD moved twice during planning (feat/framework-operator-caret → feat/framework-bundle-membership → feat/project-workspace-followups).
- F4 (2026-10-28): the ADR index in `docs/adr/README.md` is generated (`node scripts/adr.mjs index`, checked by `adr.mjs check`); never hand-edit it.
- F5 (2026-10-28): ADR 0002, which 0005 cites as the downgrade rule, is still `proposed` in the index although the engine enforces it. Owner question, not a row.
- F6 (2026-10-28): four integration tests seed v1/v27/v28 databases, so the floor turns their upgrades into refusals (measured by `rg "VALUES \((\d+)\)" tests`); row 1.4 now owns them. The upgrade path cannot be exercised while 35 is the only version, so row 1.2 adds an injectable `schemaVersion`/`durableMigrations` engine config.
- F7 (2026-10-28): the lock gate could not bootstrap — `--update` refuses a same-version mismatch, so a missing lock had no creator; row 1.5 added. The fingerprint covers tables and indexes only; the engine defines no triggers (`rg "CREATE TRIGGER" sqlite-engine.ts` → 0).
- F8 (2026-10-28): the plan-sync Stop hook recorded a planner heredoc (`python3 -I - <<'EOF'`) as a source edit at the path `<<'EOF`; every source edit so far is a worker's, on its row branch. Planner writebacks go through Edit from here.
- F9 (2026-10-28): a step that lists every column of a table in `droppedColumns` empties that table with no throw — declared intent, so accepted, but worth one line in the step-authoring docs when a real step first does it. Any durable DDL change, even a nullable column add, needs a step naming the table, because the lock compares DDL text; an identity `migrate` satisfies it.
- F10 (2026-10-28): a T3 server restart killed the row 1.4 worker mid-row (three test files edited, the new suite not yet created); resumed with the same brief plus the partial state.

## Deviations

- DEV-T2-1 (2026-10-28): the briefed commit subject `docs(adr): …` was refused by commitlint (`adr` is not an allowed scope; capitalised ADR fails subject-case); landed as `docs: the record of why runtime state lives in one SQLite file is accepted`. Later briefs carry the scope list from `commitlint.config.mjs`.
- DEV-T1-1 (2026-10-28): `DurableRow` is `Readonly<Record<string, unknown>>`, not `SQLInputValue`, matching the engine snapshot rows; `planDurableMigrations` also throws on from > to and validates the registry before the floor check. Accepted.
- DEV-T1-3 (2026-10-28): check (a) (stale lock version) suppresses (b); `--update` also refuses a SCHEMA_VERSION below the lock. Accepted.
- DEV-T1-5 (2026-10-28): a lock re-created by `--update` after deletion is seeded at the current version with no step check, so a deleted lock can be re-seeded over a drifted schema; accepted, because the deletion and re-seed show as a lock-file diff in review. Malformed lock JSON still throws from `JSON.parse` (a loud failure, accepted).
- DEV-T1-2 (2026-10-28): the worker exported `declaredDroppedColumns` from durable-migrations.ts so the engine and `undeclaredColumnLoss` share one rule, and corrected that module's header. The constructor refuses a non-integer `schemaVersion`. `getInstance` ignores a different `schemaVersion`/`durableMigrations` on a second call (tests must `shutdownInstance()` between targets). Accepted; deleting older backups blocking the upgrade became row 1.6.
- DEV-T2-2 (2026-10-28): the docs worker added "never edit the lock by hand" to the rules file (not stated in code; consistent with `--update` being the lock's only writer) and listed all four durable tables in CLAUDE.md where it named two. Accepted.
- DEV-T1-4 (2026-10-28): tests target "created version + 1", not literal 35/36, so they stay valid when SCHEMA_VERSION moves (accepted). The AUTOINCREMENT test in sqlite-backend gained a `version_history` id assertion to match its name (accepted). Two cases deleted: the v27 renumbering case and the v28 tree-column case, both covering removed behavior.

## Receipts
