---
title: one isolating workspace column in state.db, with tenant_id reserved for the owner
date: 2026-10-28
status: active
type: plan
publish: push (2026-10-28, owner "lets proceed with both PRs"; open the PR, merge on the owner's word)
initiative_branch: feat/state-db-workspace-scope
worker_cap: 3
planner_session: state-db-migrations
tags: [database, persistence, identity, hooks]
---

# One isolating workspace column in state.db

## Now (2026-10-28)

Goal: one repository has one version history across its subdirectories and worktrees; every scoped row is isolated by `workspace_id`, and `tenant_id` names the owner (`'local'` until auth exists).
Slice: none in flight. Starts after #516 (adds `deriveProjectDir`) and #519 (edits `framework-state-store.ts`) merge, on a worktree cut from origin/main.
Next decision: Q3–Q5 (owner) before T3.
Constraint: builds on the durable-migration mechanism from the predecessor plan (`plans/reference/state-db-migrations-2026-10-28.md`); this is its first real step, at schema v36.

## Intent

**Work type**: bug_fix, secondary refactor · **Risk**: high — rollback history is re-keyed.

Current state: scope ids are the cwd basename (`project-scope.ts`): the same repo started from `server/` has its own history (34 live rows), worktrees split, same-named projects collide. `tenant_id` equals `workspace_id` on every row, `organization_id` is NULL except in `execution_records`, where a writer stores the workspace name, and `chain_sessions` isolates on a third column, `continuity_scope_id`.

Desired state: one isolating `workspace_id` derived from the git common dir, `tenant_id = 'local'` (or the `--organization-id` / auth-claim owner), `organization_id` gone, durable rows re-keyed by the v36 step, basename-era rows adoptable.

Non-goals: auth or permissions, renaming TypeScript identity types, changing `hooks/lib` return shapes.

## Design decisions

| Decision                | Chosen                                                                                                                                                                                 | Rejected                    | Why                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| Workspace id (PR2)      | `<label>-<8 hex of sha256(realpath(git common dir))>`; outside git, hash of the directory's realpath; `--workspace-id` verbatim                                                        | label column; raw path      | legible and collision-free in one column; no path in logs              |
| Git common dir          | fs walk: `.git` dir → itself; `.git` file → `gitdir:` → `commondir`                                                                                                                    | spawn `git`                 | no child process at startup; worktrees resolve to the main checkout    |
| Config history (PR2)    | `config:<digest>` stays as the location value in `workspace_id`                                                                                                                        | own column                  | a config file is a location; one isolating column per table stays true |
| organization_id (PR2)   | column dropped; `--organization-id` and auth claims feed `tenant_id` (default `'local'`)                                                                                               | delete the flag             | CLI flags are in the major-version contract                            |
| Basename-era rows (PR2) | v36 step writes `workspace_id = legacy:<old tenant_id>` (config rows unchanged), `tenant_id = 'local'`; a workspace with zero rows adopts `legacy:<its label>` once                    | guess a mapping in the step | the migrating process cannot know other projects' roots                |
| chain_sessions (PR2)    | drop `continuity_scope_id`; `workspace_id NOT NULL`; `UNIQUE(run_owner_pid, chain_id, workspace_id)`; db_reader selects `workspace_id AS continuity_scope_id, NULL AS organization_id` | rename dataclass fields     | `hooks/lib` return shapes are in-contract                              |

### Interfaces

```ts
// server/src/shared/utils/project-scope.ts
export function resolveGitCommonDir(start: string): string | undefined;
export function deriveWorkspaceId(dir: string): {
  id: string;
  label: string;
  source: "git-common-dir" | "path";
};
```

## Tier T3 — stable workspace identity and the v36 step (PR2, after #516 and #519 merge)

| #   | St  | File                                                                                                                                                                                      | Change                                                                                                                                                                                                                                                   | ~Lines   | Depends | Verify                                                                                                                                                                             | Justification                                                                                                |
| --- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 3.1 | ☐   | `server/src/shared/utils/project-scope.ts`, `server/src/runtime/{options,context}.ts`, `server/src/cli-shared/version-history-scope.ts`, `server/tests/unit/shared/project-scope.test.ts` | `resolveGitCommonDir` and `deriveWorkspaceId` on top of `deriveProjectDir`; callers switch; `--workspace-id` verbatim                                                                                                                                    | +90      | —       | unit: repo root, `server/` subdir, linked worktree (`.git` file fixture), non-git dir, symlinked path                                                                              | extends the canonical derivation module (as of 2026-10-28 · flips when #516 merges and the unit test passes) |
| 3.2 | ☐   | `sqlite-engine.ts` (DDL), `durable-migrations.ts`, `durable-schema.lock.json`, `table-contracts.ts`, `server/tests/integration/database/schema-v36.test.ts` (new)                         | SCHEMA_VERSION 36; drop `organization_id` (6 tables); `tenant_id DEFAULT 'local'`; objects and version_entries gain `workspace_id` with PK/FK `(tenant_id, workspace_id, hash)`; chain_sessions and kv_state as in Design; the v36 step; lock `--update` | +120/−40 | 3.1     | fixture with live-shaped rows (repo name ×N, `server`, `default`, `config:`, a worktree name) → every row carried with its specified key, FK intact; equivalence test passes at 36 | first real migration (as of 2026-10-28 · flips when schema-v36 passes)                                       |

Tier T3 gate: `cd server && npm run typecheck && npm run validate:table-contracts`

## Tier T4 — every writer and reader uses one isolating column (PR2)

| #   | St  | File                                                                                                                                                                                                                                                                                                                 | Change                                                                                                                                                                                                      | ~Lines | Depends | Verify                                                                                                  | Justification                                                                                     |
| --- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 4.1 | ☐   | `server/src/modules/versioning/version-history-service.ts`, `server/src/cli-shared/{version-history-rows,version-history,object-store,config-checkpoint,config-restore}.ts`, `server/src/shared/utils/config-scope.ts`, `server/src/infra/database/version-tree-fsck.ts` and the engine's `repairVersionTrees` query | Filter and insert on `workspace_id`; `tenant_id` bound to the resolved tenant; `configTenantId` → `configWorkspaceId`                                                                                       | ±160   | —       | versioning, cli-shared and config-history suites; remaining `tenant_id` hits are tenant binds only      | isolation lives in one column (as of 2026-10-28 · flips when the suites pass)                     |
| 4.2 | ☐   | `server/src/infra/database/stores/sqlite-store.ts`, `server/src/engine/frameworks/framework-state-store.ts`, `server/src/engine/gates/gate-state-store.ts`, `server/src/modules/text-refs/argument-history-tracker.ts`                                                                                               | kv_state keyed by `workspace_id`; legacy `'default'` copy rule unchanged                                                                                                                                    | ±60    | —       | framework and gate state persistence suites, including per-scope load at startup                        | same (as of 2026-10-28 · flips when #519 merges and the suites pass)                              |
| 4.3 | ☐   | `server/src/modules/chains/{execution-record-store,manager}.ts`, the run registry's workspace compare, `server/src/infra/observability/tracking/resource-change-tracker.ts`, `server/src/shared/utils/{request-identity-scope,request-identity-resolver}.ts`, `server/src/runtime/options.ts`                        | Stop writing `organization_id` (locate the source that writes the workspace name into it first); `resolveTenantId(scope) = organizationId ?? 'local'`; `organizationId` leaves the workspace fallback chain | ±90    | —       | execution-record, run-registry handoff refusal and identity resolver suites; unit for `resolveTenantId` | org is the "who" (as of 2026-10-28 · flips when the suites pass)                                  |
| 4.4 | ☐   | `hooks/lib/db_reader.py`, `hooks/lib/session_state.py`, `hooks/tests/*`                                                                                                                                                                                                                                              | Select `workspace_id AS continuity_scope_id, NULL AS organization_id`; dataclass fields unchanged                                                                                                           | ±15    | —       | Python steps of `validate:all`; headless `claude -p` probe reads an active chain from a v36 db          | `hooks/lib` shapes are in-contract (as of 2026-10-28 · flips when pytest and the live probe pass) |
| 4.5 | ☐   | `version-history-service.ts` (adoption), `server/tests/integration/versioning/legacy-adoption.test.ts` (new)                                                                                                                                                                                                         | A workspace with zero version_history rows re-keys `legacy:<label>` rows in version_history, version_entries and objects in one txn and logs the count                                                      | +70    | 4.1     | adopts once, idempotent, skips when own rows exist; collision behavior documented                       | sibling of the FrameworkStateStore rule (as of 2026-10-28 · flips when the test passes)           |

Tier T4 gate: `cd server && npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run validate:all`

## Tier T5 — docs and a live upgrade of real data (PR2)

| #   | St  | File                                                                                                                                 | Change                                                                                                                                                                                                                                                                                                                                | ~Lines | Depends | Verify                                                                                       | Justification                                                                                   |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 5.1 | ☐   | `docs/architecture/sqlite-persistence.md`, `docs/guides/identity-scope.md`, `CLAUDE.md` (state.db paragraphs), ADR 0005 consequences | Current state: tenant = owner, workspace = location id, config digest as a location, legacy adoption, the collision limit                                                                                                                                                                                                             | ±120   | —       | `rg "three incompatible meanings\|continuity_scope_id" docs CLAUDE.md` → 0                   | docs and code in lockstep (as of 2026-10-28 · flips when the rg is empty)                       |
| 5.2 | ☐   | live drive, no source                                                                                                                | Copy the plugin's `state.db` into a scratch `MCP_RUNTIME_ROOT` under `~/.cache`; build; start `dist/` from the repo root, from `server/`, and from a linked worktree; read history for a prompt with legacy rows; confirm the `.v35.bak`, 95/95 version_history rows, one workspace id across the three launches, and the hooks probe | 0      | 5.1     | receipts in implementation-notes: row counts before and after, the three ids, history output | the client flow, not only green gates (as of 2026-10-28 · flips when the receipts are recorded) |

Tier T5 gate: `npm run build && npm run verify:mcp`, then from the repo root `npm run pr:check -- --body-file <body> --title "<title>"`

## Dispatch

| Row | Tier   | Effort | Failure shape                                        | branch_mode |
| --- | ------ | ------ | ---------------------------------------------------- | ----------- |
| 3.1 | sonnet | high   | wrong output                                         | own-branch  |
| 3.2 | opus   | high   | wrong approach (PK/FK reshape over durable data)     | own-branch  |
| 4.1 | opus   | high   | wrong approach (a missed filter cross-reads history) | own-branch  |
| 4.2 | sonnet | high   | wrong output                                         | own-branch  |
| 4.3 | sonnet | high   | wrong lookup                                         | own-branch  |
| 4.4 | sonnet | medium | wrong output                                         | own-branch  |
| 4.5 | opus   | high   | wrong approach (concurrent adoption)                 | own-branch  |
| 5.1 | sonnet | medium | wrong lookup                                         | own-branch  |
| 5.2 | opus   | high   | wrong approach (must observe, not assume)            | own-branch  |

## Open Questions

| Id  | Status | Precedes | Default                                                                                                               | Alternative                                                   |
| --- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Q3  | OPEN   | T3       | workspace id `<label>-<8hex>` in one column                                                                           | hash plus a separate label column                             |
| Q4  | OPEN   | T3       | config digest stays in `workspace_id` as a location                                                                   | its own column                                                |
| Q5  | OPEN   | 4.5      | `legacy:<name>` rows adopted by the first workspace with that label and no rows (first boot wins on a name collision) | no adoption; legacy rows readable via `source_workspace` only |

## Risks

| Risk                                                    | Impact | Mitigation                                                                                 | Rollback                               |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ | -------------------------------------- |
| A v36 re-key bug cross-assigns history between projects | high   | fixture with live-shaped rows; live drive on a copy; adoption only into an empty workspace | `.v35.bak` plus a pre-v36 release      |
| Two same-named projects adopt each other's legacy rows  | low    | first-boot-wins documented; ids after v36 are unique                                       | `source_workspace` read; manual re-key |
| Conflicts with the open #516/#519 stack                 | medium | cut after both merge                                                                       | —                                      |

Release: `fix(runtime)`: one repository has one version history across its subdirectories and worktrees.
