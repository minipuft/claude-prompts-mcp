{% set f = ' ' + (feature|lower|replace('-',' ')|replace('/',' ')|replace(',',' ')|replace('.',' ')) + ' ' -%}
{% set is_design = design_mode == 'on' or (design_mode != 'off' and (
     'design' in f or 'visual' in f or 'shader' in f or 'animation' in f
     or 'theme' in f or 'aesthetic' in f or 'layout' in f or 'palette' in f
     or 'colour' in f or 'color' in f or 'artwork' in f or 'art direction' in f
     or ' ui ' in f or ' ux ' in f or ' css ' in f or ' art ' in f )) -%}

# Step 4: Plan-Table

## Feature

{{feature}}

## Instructions

Using the scope, interfaces, and read-before-implementing list from Design (step 2), as verified by Verify-Paths (step 3), produce the implementation table.

**Vocabulary**: the plan file has **tiers**; a tier has **task** rows. If this plan implements a phase of a master plan, findings that bind a FUTURE phase get phase-scoped ids (`P<n>-F<m>`) and are promoted to the master plan's Findings Ledger.

Wrap your response in the four literal phase-guard headers `## Context`, `## Analysis`, `## Goals`, `## Execution` (the RESULT block goes under `## Execution`) — the guard enforces their presence and fails a response that is only the RESULT block. Measured 2026-08-11: a structurally complete plan table was rejected solely for missing these headers.

Core principles:

1. **Existing > New**: Extend existing code before creating new files
2. **Functions > Files**: Add functions to existing modules before creating new modules
3. **Parameters > Abstractions**: Add parameters before new abstractions
4. **Direct > Indirect**: Prefer direct solutions over indirection layers
5. **Explicit > Implicit**: State boundaries — agents cannot infer from omission

## RESULT (Step 4 — plan is not complete without this)

```
plan_table:
  Tier N: [description — what this tier achieves]
  | # | St | File | Change | ~Lines | Depends | Verify | Justification |
  |---|----|------|--------|--------|---------|--------|---------------|
  | . | ☐  | ...  | ...    | ...    | ...     | ...    | ...           |

  Tier N gate: [validation command between tiers]

  [Repeat for each dependency tier]

  Rules:
  - St(atus) column is REQUIRED and starts ☐ — tier_execute reads exactly this shape (☐ pending, ✓ done, ⚠ falsified premise); a plan table without it forces every executor to bridge by hand
  - Tasks without dependencies can run in parallel
  - New files are RED FLAGS — justify each one
  - Verify column: how to confirm this task works before moving on
  - Each task completable in a single agent session — split if 10+ files

new_file_justifications:
  [For each new file: why it can't be added to an existing file]

execution_dispatch:
  | Work | Agent | Why this tier |
  |------|-------|----------------|
  [Assign each tier an executor by failure shape (bounded/mechanical → smaller
   tier; decision-bearing → larger), or main thread. Always end with the
   never-delegate row: gate verdicts, tier acceptance, open-question rulings,
   the final live drive, and the scope check stay with the main thread.
   The final tier's Verify must include a build plus a live drive of the actual
   client flow — not only green gates.]

open_questions:
  [Every decision this plan could not settle from evidence, listed explicitly
   for a main-thread ruling BEFORE the dependent tier executes. Each entry
   carries: id, status (OPEN — flipped to RULED → implementation notes when
   ruled), the tier it must precede, the chosen default, and the alternative.
   An empty list is a claim that nothing was ambiguous — make it deliberately.]
{% if is_design %}
design_decisions:
  [Carry forward the Step 1 design_decisions that shape this plan — the chosen
   modern technique / aesthetic direction and the library/doc/API references that
   back the visual implementation tasks above. Decisions (chosen + rejected + why),
   not a raw option list. Evidence-based language: may/could/typically/measured.]
{% endif %}
changelog_entry:
  section : [Added | Changed | Fixed | Removed]
  entry   : [description]
```
