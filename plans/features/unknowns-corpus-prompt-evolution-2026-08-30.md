---
title: Unknowns corpus — durable ledger sink feeding prompt evolution
date: 2026-08-30
status: backlog
tags:
  - chains
  - unknowns-ledger
  - sqlite
  - prompts
  - resource-manager
---

# Unknowns Corpus → Prompt Evolution

Split out of `plans/features/mid-chain-unknown-surfacing-2026-08-20.md` (interview 2026-08-30).

## Idea (operator-originated)

Unknowns declared mid-run are edge cases discovered while running prompt X at step Y. Kept
durably and aggregated, they become (a) a library that feeds the global framework's
resources/docs and (b) a signal the server can use to propose prompt improvements as prompts
are used. This mechanizes two things already done by hand: the prompt-evolution backlog
(memory `project_prompt_evolution_backlog` — "deferred until second occurrence") and the
framework's 3-sightings pattern-maturity rule (`/knowledge-capture`).

## Measured ground (2026-08-30)

- The ledger is ephemeral: `unknownsLedger` on the per-run session JSON, PID-deleted at cleanup.
- `execution_records` terminal rows keep counts only (`unknowns_opened/closed`,
  `nodes_inserted/skipped`; parent plan D-8 adds `interrupts_raised`, `remainders_accepted`).
  No statement, no prompt/step key survives a run.
- Durable posture precedent: `version_history`, `skills_sync_manifests`
  (`src/infra/database/table-contracts.ts`; restore-by-column-intersection across schema bumps —
  a new durable table must not add a `NOT NULL` column without a default).
- Prompt edit path exists: `resource_manager` versioning + template patches
  (`mcp/tools/resource-manager/prompt/operations/template-patch.ts`). Manual edits under
  `server/prompts/**` are forbidden (CLAUDE.md §Core Principles).

## Shape (to be ruled before promotion)

1. **Sink**: durable table `unknown_sightings` — `prompt_id`, `step_name`, `unknown_id`,
   `statement`, `blocking`, `resolution`, `source` (`model|external`), `run_id`, `workspace_id`,
   `observed_at`. Written by stage 16 when an entry opens/closes. Scope column populated (it is
   the fifth table with one otherwise — `.claude/rules/sqlite-persistence.md`).
2. **Aggregation**: `≥2 distinct runs` on the same `prompt_id + step_name + unknown_id` = a
   sighting worth surfacing; `≥3` = maturity threshold. Read surface:
   `system_control(action:"analytics")` or a new `analytics` operation.
3. **Proposal, never autonomous edit**: a `resource_manager` dry-run producing a template patch
   candidate ("add an argument / a guard for <statement>") for owner review. Advisory posture and
   MCP-tooling-only both hold.
4. **Export**: the same aggregation exported as the framework-facing library (the operator's
   "resources/docs for our global framework") via the existing `skills:export` / sync path
   rather than a new one.

## Open questions

| #    | Question                                                                           | Closes when                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| OQ-1 | Retention: forever, or window per `table-contracts.ts` retention declarations?     | Declared in the table contract with a reason. ☐ (as of 2026-08-30)                                                                               |
| OQ-2 | Does the aggregation key include `statement` text (fuzzy) or only ids (exact)?     | A month of real sightings shows whether ids are reused consistently across runs. ☐ (as of 2026-08-30 · flips when the sink has ≥1 month of rows) |
| OQ-3 | Which proposal shape does template-patch already accept, and is a new one needed?  | `PATCH_TARGET_FIELDS` reviewed against the candidate types. ☐ (as of 2026-08-30)                                                                 |
| OQ-4 | Export destination for the framework library (knowledge-hub vault vs skills-sync)? | Operator rules it. ☐ (as of 2026-08-30)                                                                                                          |

**Promotion condition**: parent plan shipped (D-8 counters live) AND one real run has produced a
blocking unknown the operator wanted to keep. ✗ if two releases pass with the counters at zero.
