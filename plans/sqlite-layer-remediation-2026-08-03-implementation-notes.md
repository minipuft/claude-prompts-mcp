---
title: "SQLite Layer Remediation — Implementation Notes"
plan: plans/sqlite-layer-remediation-2026-08-03.md
date: 2026-08-03
status: active
tags: []
---

# Implementation Notes

Deviations, discovered constraints, and re-measurements found while executing the tiers.
Conservative option taken, logged, work continued — per `/unknowns` §During Implementation.

---

## Deviations

### D1 — Tier 0.1: snapshot/restore instead of "skip durable tables"

**Plan said**: `dropAllTables` skips `posture: 'durable'` tables (~10 lines).

**Shipped**: snapshot durable rows → drop everything → `applySchema()` → restore by column
intersection (~75 lines across three methods).

**What forced it**: `applySchema()` uses `CREATE TABLE IF NOT EXISTS`. Skipping a durable table
during the drop means the recreate is a no-op _for that table_, so its schema is frozen at
whatever shape it had when it was first created. A future `SCHEMA_VERSION` bump that adds a
column to `version_history` would silently never apply it, and the divergence would only surface
when a writer bound a parameter for a column that does not exist. That is the plan's own
"ephemeral-vs-durable posture" blind-spot entry — _drop-and-recreate and ALTER-migration are
mutually exclusive_ — reappearing as an implementation detail.

The round-trip keeps both properties: rows survive, and the DDL still evolves. Columns dropped
from the schema are discarded; columns added take their default. A new `NOT NULL` column with no
default throws with the table named, rather than discarding rows quietly — a schema change that
hits it needs a real migration, and failing loudly at that point is the intended signal.

**Verification that it has teeth**: emptying `DURABLE_TABLES` and re-running fails 3 of the 6 new
tests. A survival test that cannot fail proves nothing.

### D2 — Tier 1.1 pulled into Tier 0's dependency, not the reverse

**Plan said**: 1.1 depends on T0.

**Shipped**: T0 first with a local `DURABLE_TABLES` const, then 1.1 created `table-contracts.ts`
and T0's const became `DURABLE_TABLE_NAMES` derived from `posture: 'durable'`.

**Why**: keeps T0 revertible on its own — it is the data-loss fix and is the one tier that might
need to be backported alone. The intermediate const existed for one commit's worth of work.

### D3 — Gates written in TypeScript (`tsx`), not `.js`

**Plan said**: `scripts/validate-table-contracts.js` + `scripts/validate-no-phantom-columns.js`.

**Shipped**: `.ts`, run via `tsx`, matching the `generate:contracts` / `validate:frameworks`
precedent.

**Why**: a `.js` gate cannot import `TABLE_CONTRACTS` from a `.ts` module, so it would have to
AST-parse the contract file (the `validate-state-field-writers.js` + ts-morph approach). Parsing
makes the gate's view of the contract an approximation that can drift from the real exported
value — which is the exact failure class this whole plan exists to remove. Importing it makes the
SSOT literal. The DDL still needs parsing, because it exists only as a SQL string.

### D4 — A third file: `scripts/table-contracts-reader.ts`

Not in the plan. Both gates need the same embedded-schema parser and the same SQL-site scanner.
Duplicating ~180 lines across two gates to avoid adding a file would have been the worse trade.

### D5 — Tier 2.4 dropped: its target no longer exists

`plans/state-db-redundancy-cleanup.md` was deleted outright during the pre-Tier-0 cleanup (staged
deletion, 347 lines). 2.4 asked to "mark superseded, link here", which cannot be applied to a
deleted file — and deletion supersedes more completely than a marker would. Recorded as `—`
rather than `✓`: it was not done, it stopped being work.

### D6 — Tier 2.1 is add _and correct_, not add

The plan said "add the portable model". The skill's existing §Schema Decision Tree asked _Can the
data be reconstructed from source? YES → drop-and-recreate_ as a **per-database** question. That
framing is precisely what produced F11: `state.db` was classified whole-file as ephemeral, and the
one durable table inside it was destroyed. Adding a posture taxonomy beneath a decision tree that
still teaches the whole-file question would have left the two contradicting each other in the same
document.

The tree now asks per table and states that a mixed answer is the expected one.

### D7 — Tier 2.3 corrects two claims, not one

The plan named `"Rows are workspace-scoped"`. The adjacent sentence — _"`SCHEMA_VERSION` bump
triggers drop-and-recreate; no migration code since `state.db` is ephemeral"_ — was falsified by
Tier 0 four hours earlier. Leaving it would have put CLAUDE.md in direct contradiction with the
snapshot/restore code shipped in the same plan.

### D8 — Terminal failure record emitted from the pipeline catch, not stages 18/21

**Plan said**: "stages 18 / 21 — emit terminal records on failure and abort paths".

**Shipped**: `failed` from `PromptExecutionPipeline`'s existing catch boundary; `cancelled` from
stage 21.

**What forced it**: stage 18 is the renderer and stage 21 is the formatter. A throw in any of the
other twenty stages reaches neither, so its session's last record would stay `working` — the exact
defect 3.4 exists to close. The pipeline's catch is its single error boundary
(`architecture.md`: handler/orchestration CATCHes, one boundary), so it is the only place that
observes every failure. A test asserts a throw from `InjectionControl`, which is upstream of both
named stages.

Abort needed a separate seam because it does **not** throw: `GateVerdictProcessor` sets
`state.session.aborted = true` and breaks, so the catch never fires. Stage 21's existing
`emitChainTerminalRecord` was widened instead. That flag had two writers and **zero readers** before
this — a write-never field, the class the pipeline plan's Tier 10 detector targets.

### D9 — Tier 3.3 forced a SCHEMA_VERSION bump the plan did not mention

A view is only created by `applySchema()`, which runs only on a version mismatch. Adding
`v_execution_history` to the DDL without bumping leaves every existing database without it — and
Tier 1.2's `assertSchemaMatchesContracts()` then **fails startup**, because the contract declares a
view the live schema lacks.

So any DDL addition now implies a bump. That is a real consequence of Tier 1.2 worth stating: the
startup assert converts "forgot to bump" from a silent divergence into a boot failure, which is the
intended direction, but it means Tiers 4 and 6 must budget a bump for any schema change.

**The bump conflicts with 3.3's own verification.** The plan says "SQL probe returns the 52 existing
rows", but the bump drops `execution_records` (posture `ephemeral`). The rows cannot both be
verified and survive. Resolved by proving the view SQL against a copy of the real database _before_
bumping — it returned 31 sessions covering all 58 checkpointed records — and then letting the bump
proceed. The trade is recorded in the `SCHEMA_VERSION` docblock rather than left for someone to
discover: 35 of the 64 dropped rows were permanently stuck at `working`, so carrying them into a
history feature would have imported mostly garbage.

---

## Re-measurements that contradicted the plan

### R1 — "11 tables + the view" is 10 tables + 1 view + 1 implicit

The live database reports 11 tables, but one is `sqlite_sequence`, which SQLite creates on its own
as soon as any table declares `AUTOINCREMENT`. It is never declared in `applySchema()`.

**This was load-bearing, not cosmetic**: 1.2's set-equality assert compares `sqlite_master` against
`TABLE_CONTRACTS`. Written against the plan's count it would have thrown on _every startup_ of
every install. `SQLITE_INTERNAL_TABLES` now names the exclusion, and the reason is recorded where
the exclusion lives.

### R2 — The phantom-column gate does NOT catch F2, its own motivating finding

`execution_records.workspace_id` / `organization_id` are NULL on all 52 rows, and the gate passes
them — because `execution-record-store.ts:91` _does_ name both columns in its INSERT list. The
defect is one level down: `getScopeOptions()` structurally cannot supply the values, so the bound
parameter is always NULL.

Two distinct classes, and only one is visible to a static column-list check:

| Class                     | Shape                                     | Caught by                               |
| ------------------------- | ----------------------------------------- | --------------------------------------- |
| Declaration-level phantom | column never appears in any INSERT/UPDATE | `validate:no-phantom-columns`           |
| Value-level phantom       | column is written, always with NULL       | nothing yet — Tier 4.1 fixes the source |

The gate's header states this explicitly rather than implying coverage it does not have. A gate
that is trusted for something it cannot see is worse than no gate.

### R3 — The gate found 8 phantom columns the audit never enumerated

F2 named `execution_records`. The measured set is broader — every table with scope columns except
`kv_state` declares and indexes `workspace_id` / `organization_id` and never writes them:

| Table                | Columns                       | Closed by                |
| -------------------- | ----------------------------- | ------------------------ |
| `chain_sessions`     | organization_id, workspace_id | Tier 6.5                 |
| `version_history`    | organization_id, workspace_id | Tier 6.1                 |
| `resource_changes`   | organization_id, workspace_id | Tier 4.3                 |
| `chain_run_registry` | organization_id, workspace_id | execution-ledger Tier 10 |

This is F9 ("workspace isolation claimed generally, delivered once") measured precisely instead of
described. Note `version_history` — rollback history is global across every project sharing
`state.db`, which the audit did not state.

### R4 — One documented false positive: `kv_state`

`SqliteStateStore` assembles its INSERT column list at runtime from `PRAGMA table_info`, so no
literal SQL names `workspace_id` anywhere, yet the existing integration test proves both columns
are written. Recorded as an `acceptedPhantomColumns` entry whose `closedBy` names a _gate
improvement_ rather than a tier — the honest exit condition.

Loosening the parser to "the name appears anywhere in the owner file" would clear this false
positive and simultaneously pass every true finding in R3, since `workspace_id` appears throughout
the codebase as a TypeScript field name. Keeping the false positive visible is the better trade.

### R5 — The single-writer check flagged the contract file itself

`table-contracts.ts` quotes SQL inside `reason` strings to explain why a column has no writer, and
the scanner read those as writes. `SQL_SCAN_EXEMPT` now excludes it, with the reason recorded.

### R6 — Tier 2's gate is unsound in two independent ways

The plan's gate is `bash ~/.claude/scripts/check-rules.sh && npm run validate:format`.

**It cannot see either file the tier writes.** The script sets `ROOT="${HOME}/.claude"` and globs
exactly `CLAUDE.md` + `rules/*.md`. 2.1 writes `~/.claude/skills/**` — not in scope, and skills are
unbudgeted by charter anyway. 2.2 writes this _project's_ `.claude/rules/` — also not in scope; the
charter states plainly that `check-rules.sh` covers the global framework only and that project
budgets are advisory. Both subtiers would have reported green without a single byte being measured.

**It was also exiting 1 when the tier started** — `observations.jsonl:3` failed schema validation
(`missing ['note', 'type']`), and since the gate is an `&&` chain that unrelated failure
short-circuited before `validate:format` ever ran. **Re-measured 2026-08-04: fixed upstream, now
`exit=0`, 15 files, 0 failures.** The scope defect above is the durable one; this half was
transient.

Substituted: Prettier `--check` on all three files (clean), a forbidden-word scan against
`scripts/forbidden-words.txt` (clean), and explicit line/token measurement against the charter
budgets. The `observations.jsonl` defect is left alone — it is in the user's global framework repo,
unrelated to this plan, and silently fixing another repo's ledger to make a gate green is the
opposite of what the gate is for.

### R7 — The ledger counts drifted, and kept drifting during execution

| Plan asserts                   | Measured at Tier 3 start |
| ------------------------------ | ------------------------ |
| 52 rows in `execution_records` | **64**                   |
| 30 stuck at `working`          | **35** (29 completed)    |
| view at `sqlite-engine.ts:440` | ~584                     |

The ledger grew by 12 rows between the audit and execution — this session's own MCP traffic. That
is F8 (no retention) demonstrating itself mid-plan rather than being argued for.

### R8 — `verify:mcp` passed a build where the new action was structurally dead

11/11 green, and the `execution_history` action returned _"Execution Ledger Not Available"_ for
every call. The wiring read `promptExecutor.getExecutionRecordStore()` next to the other
`systemControl` setters, but the executor constructs that store inside `setDatabasePort`, which runs
later — so the getter returned null and the setter never fired. It typechecked, linted, and passed
every suite.

`verify:mcp` proves the three tools answer; it does not enumerate actions, so a dead action is
invisible to it. Caught only by spawning a server from `dist/` and calling the action. **A new
action needs an end-to-end call, not a surface check** — the same lesson as R2 at a different layer:
a gate is worth what it actually observes.

### R9 — Copying `state.db` without its `-wal` silently loses rows

A file copy reported 58 records where the live database reported 64: six sat in an un-checkpointed
WAL. This is F4 (`shutdown()` never called, so WAL never checkpoints) surfacing as a data-integrity
trap rather than a disk-usage one — any backup, snapshot, or `cp`-based inspection of `state.db`
silently drops recent writes. Strengthens the case for Tier 5 and is worth a line in the ops docs.

---

## Discovered constraints

### C1 — `kv_state` carries one posture while its discriminators need two

`key='resource_hashes'` is a cache; `key='framework'`, `'gates'`, and `'arg_history'` are user
state. The table is declared `posture: 'ephemeral'`, which is what it does today: a
`SCHEMA_VERSION` bump resets the active framework, gate enable/disable, and ~55 KB of accumulated
argument history.

**Not acted on.** Making `kv_state` durable is a behaviour change beyond Tier 0's scope, and the
posture taxonomy is per-table while the need here is per-key. Recorded in the contract's `finding`
and raised here for a scoping decision. This is the one open question these two tiers surfaced and
did not answer.

### C2 — `validate:all` was already red before this work

Three pre-existing failures, none in files touched by these tiers:

| Step                            | Cause                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `validate:format`               | `README.md`, `plans/acquisition-recovery.md` unformatted; three `plans/` files tracked in git but deleted from disk             |
| `validate:no-methodology-vocab` | `src/mcp/tools/index.ts:384`, `prompt-engine.schema.ts:145` — both unmodified in this tree, so the failure is on committed HEAD |
| `validate:documented-options`   | `docs/guides/release-process.md`, `docs/guides/cli.md` — pre-existing working-tree edits                                        |

The Tier 1 gate is therefore "every `validate:*` step passes except the three already failing, and
both new gates pass" — not "`validate:all` is green", which was not achievable in this tree and
is not this plan's work to fix.

### C3 — Project CLAUDE.md was already at its budget ceiling

Measured before Tier 2 touched it: **~3978 tok**. The charter's most generous tier is
`10+ domains → ~4k tok`, followed by _"and re-run the eviction test — that is where dilution
starts."_ So the file entered this tier at the ceiling, not under it.

The edit lands at ~4187 tok (+209). The growth passes the eviction test on its own terms — the
text it replaces made two claims that are false, and an agent trusting either walks into the F11
data-loss path or assumes a workspace isolation that four tables do not provide. That is
enforcement, not description.

It was still trimmed once: the first draft enumerated all four non-isolating tables inline, which
duplicates the new glob-loaded rule. CLAUDE.md now states the fact and the one user-visible
consequence (`version_history` rollback history is machine-global) and points to
`.claude/rules/sqlite-persistence.md` for which four and what closes each.

**Left for a future `/framework-audit`, not for this plan**: the file is over budget in aggregate,
which is a whole-file eviction pass, not something a persistence tier should do opportunistically.

### C4 — The abort path shipped untested and was caught by the operator, not by a gate

Tier 3.4 covers two terminal paths. The failure path got 5 tests; the abort path got zero, and was
still reported as complete. Every mechanical gate passed: typecheck, both ratchets, 1906 unit tests,
460 integration tests, `verify:mcp` 11/11. Nothing in the toolchain can observe "a branch you wrote
has no test" — coverage thresholds would not have caught it either, because the branch _is_
executed by the existing completion tests, just never asserted on.

Closed 2026-08-04 with 6 tests, falsified two ways: deleting the abort branch fails 3 of them, and
inverting the abort/complete precedence fails exactly the one test written for that precedence. Each
test targets a distinct mutation rather than all six failing together, which is what makes the set
diagnostic instead of merely red.

The process gap this exposes is upstream of testing: a subtier whose Change column names **two**
behaviours needs its Verify column to name two, and nothing checked that correspondence.
