---
number: 0005
title: "Runtime state lives in one SQLite file"
status: accepted
date: 2026-10-28
initiative: state-db-migrations
supersedes:
superseded_by:
---

# ADR 0005: Runtime state lives in one SQLite file

## Context

Runtime state used to live in JSON files. The owner left them for three reasons: the files the
server created were hard to keep track of and manage, every new feature made them longer and
harder to work with, and performance was expected to degrade as they grew. That last reason was
anticipated, not measured.

Several processes write this state (the MCP server and the `cpm` CLI) and Python hooks read it,
so it needs safe concurrent access and reads from another language. SQLite arrived with PR #76
(2026-03-11). The server uses Node's built-in `node:sqlite`, which has no native dependency and is
the reason the server's Node floor is 22.13.

## Decision

State is one `state.db` file per runtime root. Every project on the machine shares it, and each
scoped table isolates projects with a scope column.

Each table declares a posture in `server/src/infra/database/table-contracts.ts`, the single source
of truth for owner, posture, scope and retention:

- **durable**: rows exist nowhere else (`version_history`, `skills_sync_manifests`, `objects`,
  `version_entries`).
- **derived**: rebuilt from other tables.
- **ephemeral**: live-process state.

On a schema version change, derived and ephemeral tables are dropped and recreated from the
embedded schema. Durable rows are carried across by numbered migration steps: pure transforms over
the in-memory snapshot of durable rows, applied inside the same transaction as the recreate. A
restore that would lose a durable column no step declared fails startup instead of dropping data.

Before an upgrade the engine writes a backup copy of the file, `<db>.v<old>.bak`, keeping the latest
only. Databases older than schema v35 are refused rather than partially carried. An older engine
refuses a newer database ([ADR 0002](0002-schema-downgrade-refusal.md)). A committed fingerprint of
each durable table's schema makes CI fail a durable schema change that ships without a step.

## Alternatives considered

1. **Keep JSON files.** Rejected: the three problems above.
2. **One database file per project.** Isolation comes free, but the CLI, hooks and server would each
   need to locate the right file from a working directory, and cross-project features (reading
   another workspace's history read-only) would need to open several files.
3. **A database server (Postgres, Redis).** Rejected: a local developer tool launched over STDIO by
   an MCP client cannot ask its user to install and run a service.
4. **An ORM or migration library (Drizzle Kit, Kysely Migrator).** Rejected: `node:sqlite` support
   exists only through community adapters, and the library would be a second schema source beside
   the embedded one.
5. **No migration mechanism** (the previous drop-and-recreate with column-name matching).
   Rejected: a renamed durable column silently lost its values.

## Consequences

### Positive

- Caches change freely; durable tables change only with a step and a test.
- A durable column can no longer be lost silently.

### Negative / risks

- One file holds every project's history, so a scope bug is a privacy bug: the scope column is part
  of every query.
- There are no down migrations. The backup is the way back.
- `cpm` opens the same engine code, so both writers must ship the same steps.
- A database below the v35 floor must be moved aside by hand.
- Known open limitation: the scope id today is the basename of the project directory. A project
  started from a subdirectory or a worktree gets a separate scope, and two projects with the same
  directory name share one. A follow-up change replaces it with an id derived from the repository's
  location.

## Validation

- The schema fingerprint check in CI fails a durable schema change that has no migration step.
- A durable table changes only together with a step and a test that exercises it (review
  convention; the fingerprint check enforces the step half).

## References

- [Table contracts](../../server/src/infra/database/table-contracts.ts) and the
  [schema owner](../../server/src/infra/database/sqlite-engine.ts).
- [Persistence architecture](../architecture/sqlite-persistence.md).
- [ADR 0002](0002-schema-downgrade-refusal.md): newer databases are refused by older engines.
