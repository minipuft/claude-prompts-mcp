You are entering implementation mode. This prompt is a signal and a standards gate, not a workflow engine: the dev loop, thresholds, checklists, and RESULT templates are owned by the always-loaded rules (dev-workflow.md, refactoring.md, architecture.md, cleanup-standards.md) and the skills they dispatch. Deterministic enforcement (plan flush at turn end, deviation-log creation, validation ledger) is owned by the global plan-hygiene hooks and arms the moment you Read the governing plan file.

**Vocabulary** (one word per level): an initiative's master plan has **phases** (P0, P1, …); a phase's plan file has **tiers**; a tier has **task** rows. dev-workflow.md's numbered "Phases 0–6" are a different axis — that is the per-change dev loop, not initiative structure; when this prompt names a dev-loop step it says so explicitly (e.g. "dev-workflow Phase 1 discovery"). tier_execute's protocol uses lettered sections.

Your job on receiving this signal, in order:

1. **Classify** — emit the Classify RESULT block (dev-workflow.md Phase 0): work_type (test | bug_fix | feature | refactor | optimize), strategy, scope, skip_gates (dev-workflow.md Gate Skip Policy is the single authority), primary_skill. Mechanical changes skip ceremony and go straight to the edit.
2. **Bind** — if a plan file governs this work, Read it before the first edit; reading arms the plan-hygiene tripwires for this session. If no plan governs it, say so in one line.
3. **Route** — invoke the primary skill for the classified type (/testing, /debugging, /search → /refactoring, or context-specific). Discovery (dev-workflow Phase 1) is never skippable for non-mechanical work. When the deliverable is public documentation, route the editorial work through `>>documentation_change` after classification; that chain owns placement, drafting, and semantic review, so do not reproduce its phases here.
4. **Dispatch** — when the governing plan carries an Execution Dispatch section, execute tier-by-tier through `>>tier_execute` (its delegated mode builds worker briefs from the plan's task rows and owns the brief contract). Judgment never delegates: gate verdicts, tier acceptance, open-question rulings, the final live drive, and the scope check stay with you. Rule on the plan's open questions before dispatching a dependent tier, and record rulings in the implementation notes with the plan's question status flipped to RULED.
5. **Execute under the standards** — pre-flight RESULT before source edits; deviations (`DEV-T<tier>-<n>` rows) and discovered unknowns written to the implementation notes as they happen, not at the end; findings that bind a FUTURE phase promoted to the master plan's Findings Ledger (`P<n>-F<m>` ids); the project CLAUDE.md validation suite before declaring done.

| Work Type | Strategy                                                 | Primary Skill          |
| --------- | -------------------------------------------------------- | ---------------------- |
| test      | discover existing tests → integration first → unit edges | /testing               |
| bug_fix   | reproduce → root cause → minimal fix → regression test   | /debugging             |
| feature   | discovery → pre-flight → implement → validate            | /search → /refactoring |
| refactor  | pre-flight → diagnosis → extract/move → validate         | /refactoring           |
| optimize  | measure → bottleneck → fix → re-measure                  | context-specific       |
