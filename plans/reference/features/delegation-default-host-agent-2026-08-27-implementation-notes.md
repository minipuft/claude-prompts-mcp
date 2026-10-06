---
title: "Implementation notes: delegation default host agent"
date: 2026-08-27
status: reference
tags: [chains, delegation, plugin-distribution]
---

# Implementation Notes — Delegation default: host agent

Companion to `delegation-default-host-agent-2026-08-27.md`. Created before the first source edit.

## Pre-flight (refactoring.md)

- failures: 2 — `defined` (`'chain-executor'` literal at 3 runtime sites + exporter) + `layer`
  (orchestrators own a default the strategy should own) → compound **missed extension point** →
  `DelegationStrategy.formatToolCall` resolves the host default; orchestrators pass `undefined`.
- identification: the default executor name is host vocabulary → per-strategy constant; only
  Claude Code's `Task` needs a real name (`general-purpose`); other hosts get no line.

## Deviations

| Id       | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Conservative option taken                                                                                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T1-1 | Tier gate sweep authored "only CHANGELOG + plans/reference"; measured 6 more hits — 2 source comments (`strategy.ts`, `brief.ts`), 1 test comment, 3 `not.toContain('chain-executor')` assertions.                                                                                                                                                                                                                                                                                             | Kept the comments (they record WHY the default changed) and the negative assertions (they are the regression guard); corrected the gate wording in the plan rather than deleting the evidence.                                   |
| DEV-T1-2 | First M4 mutation (prefixing the boundary line with text) left both asserted substrings intact → 18/18 green. A weak mutation, not a weak test.                                                                                                                                                                                                                                                                                                                                                | Re-ran with the line deleted outright → 1 red (`states the worker boundary with and without gates`). Recorded both runs.                                                                                                         |
| DEV-T1-3 | **SUPERSEDED 2026-08-27.** First recorded that no live path renders a delegated brief. That was a null result with no positive control (`dev-workflow.md`): the probes stalled at Progress 1/2 on a framework phase-guard gate on step 1, before the delegated step rendered. Positive control: `%clean >>minimal_prompt ==> >>readme_improver` resumes to 2/2 with `subagent_type: "general-purpose"` (this branch) vs `claude-prompts:chain-executor` (`main`). No delegation defect exists. | Tier 2 recharacterized from fix to hardening; its 2.1/2.2 fix rows killed with reasons; the regression test (2.0) kept and falsified. The lesson — an absence needs a probe shown able to see a presence — is the reusable part. |
| DEV-T1-4 | The strategicImplement contract says one tier per submission compiled into a `prompt_engine` workflow. This tier was executed on the main thread without compiling a workflow: ~14 files across CI, packaging, hooks, docs and source, one actor owning HEAD, and the plan's dispatch table says main thread for every row.                                                                                                                                                                    | Recorded here so the omission is a decision, not a drift. The Tier 1 gate ran in full.                                                                                                                                           |

## Validation Ledger

| Date       | Command                                                          | Result                                                                                            |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 2026-08-27 | `npm run typecheck`                                              | exit 0                                                                                            |
| 2026-08-27 | `test:match` delegation/brief/skills-sync/fixtures (14 patterns) | 32 suites, 385 tests, all passed                                                                  |
| 2026-08-27 | `npm run validate:python`                                        | 254 passed (after `ruff format` on one test file)                                                 |
| 2026-08-27 | `npm run validate:contracts` · `validate:arch`                   | OK · 0 errors, 12 pre-existing warnings                                                           |
| 2026-08-27 | `npm run validate:agent-plugins`                                 | 4 targets, all consumes resolve                                                                   |
| 2026-08-27 | `npm run lint:ratchet` · `typecheck:tests:ratchet`               | 3094/974 no regressions · 367 no regressions                                                      |
| 2026-08-27 | `npm run build && npm run verify:mcp`                            | 18/18 checks passed                                                                               |
| 2026-08-27 | `npm run test:ci`                                                | 211 suites, 2722 passed, 1 skipped                                                                |
| 2026-08-27 | `npm run validate:plan-row-tracking` · `prettier --check`        | OK · all changed md/json/yml conform                                                              |
| 2026-08-27 | stdio probe → `dist/` (this branch and `main`)                   | delegated brief renders live; `general-purpose` vs `main`'s `claude-prompts:chain-executor` (A/B) |

## Falsification record

| Mutation                                                                   | Guard neutered                      | Red                                                                    |
| -------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| M1 re-prefix bare names with `claude-prompts:`                             | `ClaudeCodeStrategy.formatToolCall` | 11 failed / 42 (`delegation-renderer` + `delegation-operator-flow`)    |
| M2 `CLAUDE_CODE_DEFAULT_AGENT_TYPE = 'chain-executor'`                     | the host default                    | 6 failed / 42                                                          |
| M3 `formatHandoffBlock` always emits `agent_type` (`?? 'general-purpose'`) | non-Claude omission                 | 1 failed / 27 (`non-Claude strategies omit agent_type …`)              |
| M4 boundary line deleted from `buildResultContractSection`                 | R5 worker boundary                  | 1 failed / 18 (`states the worker boundary …`); token test still green |
| M5 Python fallback back to `"chain-executor"`                              | `post-prompt-engine.py` fallback    | 1 failed (`…falls_back_to_general_purpose`)                            |

Each file was restored and its SHA re-checked after every mutation.

## Live probe (for Tier 2)

Newline-delimited JSON-RPC over stdio to `node dist/index.js` with `MCP_WORKSPACE` pointing at an
empty directory; `initialize` (`clientInfo.name: "claude-code"`) → `notifications/initialized` →
`tools/call prompt_engine`:

1. `{command: ">>readme_improver ==> >>codebase_protocol_init"}` → response text contains
   `chain_id="chain-readme_improver#1"` and the one-line advisory that step 2 is delegated.
2. `{chain_id, user_response: "…", gate_verdict: {overall: "PASS", rationale: "probe"}}` → step 2
   renders `codebase_protocol_init` inline: no `EXECUTION BRIEF`, no `HANDOFF INSTRUCTIONS`, no
   `subagent_type`.
3. `{workflow: {version: 1, nodes: [{id: "one", promptId: "readme_improver", args: {doc_type: "reference"}, subagentModel: "fast"}, {id: "two", promptId: "codebase_protocol_init", subagentModel: "fast"}], edges: [{from: "one", to: "two"}]}}`
   → node one renders inline; only the advisory for node two appears.

Both sequences behave identically against a `main` (811ece55) build.

## Open-question rulings

- 2026-08-27 owner interview (three questions): R7 derive-at-read · R8 both gates · R9 this branch. **Then the positive control ran and voided R7's premise** — no read-site change is needed; the plan's R7/R8 are corrected in place and Tier 2's fix rows are killed. R9 (this branch) stands.

## Findings promoted

- F1 → plan Tier 2 (live delegated brief unobservable; e2e asserts `ok: true` only).
