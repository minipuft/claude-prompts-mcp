---
title: "A chain prompt's own gates run once, on the chain's final step: implementation notes"
plan: chain-prompt-gates-final-step-2026-10-05.md
date: 2026-10-05
status: active
tags: [gates, chains]
---

# Implementation notes

## Deviations

- DEV-1 (rows 1.1 to 1.3): the source change is about 140 lines against a 60-line bound, half of it docblocks; recording the chain's gates before the walk reordered gate lists on every step and turned two unrelated pins red, so they are recorded at the final step instead. `gate-enhancement-service.ts` reached 1,072 lines and the `max-lines` ceiling for that one file was raised with the ratchet's own override, reason logged in the baseline. The pin that asserted the old absence was rewritten in row 1.1, not 1.2. Ruling R4 was left as measured: a chain prompt named in an arrow-chain or workflow segment expands, and its own gates reach no expanded node, before and after; carrying the segment's prompt id through the parser, the blueprint and the walk is well beyond the size allowed. Row 1.3 was added on the worker's finding (R6). Only `implementation_plan` was driven in the bundled survey; the other chains were read from their YAML.

- DEV-2-1 (row 2.1): the brief said #445's row 1.2 had left a pin naming both gates on `implementation_plan`'s fifth step; no test drives the bundled chain (`rg -l implementation_plan server/tests/e2e` is empty), so the worker added a unit pin over the shipped file instead, with a control on `tech_evaluation_chain`. The brief should have measured that first. The #445 changelog bullet, which stated both gates and "neither declares an `enforcement_mode`", was corrected in the same commit.

## Findings

- The chain's gates show in the final step's review and not in its first render's guidance, as a step prompt's own included gates already do (a gate with no activation rules counts as active only when explicit).
- If the chain's gates pass on the last step and a `remainder` then appends a node, the new last node is reviewed against them again. Pinned as measured.
- An investigation node inserted AFTER the final step does not take the chain's gates; the last walked step keeps them.
- `tech_evaluation_chain` declares `technical-accuracy` and `code-quality` and its category activates `creed-fidelity`; `research_chain` declares `research-quality` and `content-structure`; `documentation_change` declares four gates and its category adds two. Each now has those reviewed on its last step. Not driven.
- `GateResolutionInput.chainGateIds` has no writer, and the run-wide union in `executionPlan.gates` has one reader that no drive reached.
- The launcher lists a framework gate named in a chain's include although the final step does not review it; no bundled chain includes one.
- Row 2.1: a bundled prompt not in `mcp_prompt_mode: launch` lists no gates in its MCP prompt message, so the launcher envelope cannot pin `implementation_plan`'s gates; the real behavioral pin would be a drive to its fifth-step review with CAGEERF-valid answers at each step, not written.
