# Step 5: Validation & Completion

## Feature

{{feature}}

## Instructions

Using the plan table from the Plan-Table step (step 4) and the design from the Design step (step 2), produce the validation strategy and completion criteria. Then write the COMPLETE plan (all steps combined) to a file for persistence across sessions — see Final Action for where.

Wrap your response in the four literal phase-guard headers `## Context`, `## Analysis`, `## Goals`, `## Execution` (the RESULT block goes under `## Execution`) — the guard enforces their presence and fails a response that is only the RESULT block. Measured 2026-08-11: the guard rejects responses missing them.

## RESULT (Step 5 — plan is not complete without this)

```
testing_strategy:
  | What to test | Test type | Location | Why this type |
  |-------------|-----------|----------|---------------|
  | ...         | ...       | ...      | ...           |

done_criteria:
  | Criterion | Validation | Pass Condition |
  |-----------|-----------|----------------|
  | ...       | ...       | ...            |

documentation:
  | Doc | Update Needed |
  |-----|---------------|
  | ... | ...           |

risks:
  | Risk | Impact | Mitigation | Rollback |
  |------|--------|-----------|----------|
  | ...  | ...    | ...       | ...      |

release:
  commit_convention : [type(scope): description]
  scope             : [commit scope]

growth_capture:
  - [ ] Any pattern worth capturing in /knowledge-capture?
  - [ ] Any memory updates needed?
  - [ ] Any skill corrections from this work?
```

## Final Action

After filling the RESULT, assemble ALL steps (1-5) into a single plan file. Write it beside the governing master plan when one exists — repo-level `plans/` directory, e.g. `plans/<initiative>-p<N>-<slug>-<date>.md`. Use `~/.claude/plans/` only when no repo plan directory governs the work. The plan file is the contract — it must contain the full output of every step, not just this one, and must carry tier tables with the Status column (☐) and §Open Questions with status. It must NOT contain deviation logs or ruling rationales — those live in the sibling implementation-notes file.
