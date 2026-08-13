---
title: "Documentation Governance Implementation"
date: 2026-08-12
status: done
tags: [docs, governance, chains]
---

# Documentation Governance Implementation

**Status:** COMPLETE
**Date:** 2026-08-12

## Objective

Create one canonical path for public documentation changes without turning
`strategicImplement` into an editorial workflow engine.

## Decisions

1. The README charter owns durable positioning, terminology, and voice policy.
2. `documentation_change` owns intent, placement, drafting, review, and validation flow.
3. `readme_improver` remains the drafting implementation for root README changes.
4. Semantic gates review claims that require judgment; `validate-readme.js` checks only
   mechanically decidable rules.
5. Diátaxis markers remain internal editorial metadata. Reader-facing navigation uses tasks.
6. No new framework or Style resource is introduced in this phase.

## Acceptance Criteria

| Tier | Task                                                          | Observable completion                                                                     |
| ---- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| T1   | Create four focused semantic gates through `resource_manager` | All four inspect and reload successfully                                                  |
| T2   | Create `documentation_change` through `resource_manager`      | Prompt inspects as a chain and reuses `readme_improver`                                   |
| T3   | Route documentation work from `strategicImplement`            | Its routing contract names `documentation_change` without embedding its phases            |
| T4   | Amend charter and README                                      | Charter defines canonical terms; README exposes no Diátaxis jargon outside hidden markers |
| T5   | Extend deterministic validation                               | Fixtures prove reader-visible Diátaxis terminology fails while hidden markers pass        |
| T6   | Validate integration                                          | Targeted checks pass and resource inventory has no orphaned or duplicate path             |

## Removal and Closeout

- Delete no existing prompt, gate, framework, or validator: this plan adds missing ownership rather
  than replacing an existing canonical path.
- Do not create a second README authoring prompt or an editorial framework.
- If `documentation_change` cannot compose `readme_improver`, remove the partial chain before
  choosing another design.
- Close only after the four gates, chain, routing, charter, README, validator, and tests agree.

## Validation

```bash
cd server
npm run validate:readme
npm run typecheck
npm run lint:ratchet
```

Run targeted tests for README validator behavior and resource-manager integration before broader
validation.

## Completion

- Four focused gates are canonical under `server/resources/gates/` and included in the generated
  gate index.
- `documentation_change` is a two-step chain that reuses `readme_improver`; `strategicImplement`
  routes public-documentation work to it instead of duplicating editorial phases.
- The prompt packaging allowlist includes only `documentation_change`, `readme_improver`, and
  `strategicImplement` from their otherwise ignored categories.
- The charter owns semantic policy. The README validator owns the mechanically decidable rule that
  Diátaxis terminology stays inside maintainer comments.
- No alternate authoring prompt, editorial framework, legacy path, or temporary compatibility shim
  remains.
