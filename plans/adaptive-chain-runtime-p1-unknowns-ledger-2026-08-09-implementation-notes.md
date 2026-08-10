---
title: "P1 Unknowns Ledger — Implementation Notes"
date: 2026-08-09
status: backlog
tags: []
---

# P1 Unknowns Ledger — Implementation Notes

Plan: `plans/adaptive-chain-runtime-p1-unknowns-ledger-2026-08-09.md`
Started: 2026-08-09 (post-compaction session, dispatch per plan §Execution Dispatch)

## Preconditions log

- MCP restart: **NOT yet done** — the running stdio server predates the writer fix. Evidence: applying the staged verification template returned the pre-fix rollback error ("Mutation produced invalid resource state; restored previous files"). `dist/index.js` rebuilt 15:12 (after fix), but the live process is older.
- Staged template application: **DEFERRED** to post-reconnect (bundled with final live drive, which needs the reconnect regardless).
- Orphan prompt deletion: deferred with it (optional, operator's call).
- implementation-notes.md: created before first edit (this file).

## Tree-state caution (recorded before first edit)

Concurrent session has uncommitted changes in P1-adjacent files, notably `server/tooling/contracts/prompt-engine.json` (P1 row 3 target) and its `_generated/` outputs, plus `tool-routing.ts`, `response-assembler.ts`, `parser-utils.ts`, `http-mcp-client.ts`, `operators.json`. Rule: workers edit **additively**, never revert foreign hunks. `generate:contracts` is deterministic from contracts JSON, so regenerating over foreign contract edits is safe.

## Deviations

| #   | Tier | What forced it                                                                                                                                                  | Conservative option taken                                                                                                              |
| --- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | pre  | Live server predates writer fix; template update rolled back                                                                                                    | Defer template application + orphan deletion to post-reconnect; proceed with Tiers 1-6 (none need the live server until final drive)   |
| D2  | T1+  | Dispatch table assigns tier-gate spot-checks to haiku; the checks are ~5 rg lines                                                                               | Run spot-checks inline main-thread (cheaper than a subagent boot); judgment unchanged — claims verified against tree before acceptance |
| D3  | T1   | Interface method on ChainSessionService broke typecheck (manager.ts implements it)                                                                              | Anticipated in brief: minimal throwing stub at manager.ts:1878, replaced in T3                                                         |
| D4  | T2   | Plan row 4 assumed a single McpToolRequest build site; a second upstream narrowing site exists (src/mcp/tools/index.ts:~787) that would silently drop the param | Worker wired both sites per brief instruction; classic enumerate-consumers case                                                        |
| D5  | T4   | Plan said stage-16 call "after verdict processing" — but all verdict paths early-exit, which would silently drop observations on FAIL-verdict resumes           | Placed BEFORE verdict processing + before chain-context refresh (same-call visibility). Judged correct: plan defect, not worker drift  |
| D6  | T4   | Stage-16 constructor change broke 2 test files' construction sites                                                                                              | Additive edits to step-response-capture-stage.test.ts + response-capture-hooks.test.ts (typed mock to protect ratchet baseline)        |
| D7  | T3   | Opus added an integration test (unknown-observations-flow) not in the plan — verify:mcp cannot reach this path                                                  | Accepted; row 12's separate lifecycle file will extend this file instead of duplicating coverage                                       |

## Environmental note (affects final gate)

`test:ci` currently reports 2 pre-existing failures in `tests/unit/execution/formatting/response-assembler-cta.test.ts`, driven by the CONCURRENT session's uncommitted `response-assembler.ts`. Not ours; final-gate criterion is therefore "no NEW failures beyond those 2".

## Semantics rulings (main thread, T3)

- resolve-on-resolved → idempotent refresh (resolution/resolutionStatement updated, first resolvedAtStep kept) — retry-safe.
- discover-on-resolved → re-open (re-stamp discoveredAtStep, clear resolution fields) — same-step replay is a fixed point; later-step re-discovery is genuine re-emergence.
- Batch atomicity: computeUnknownLedger is pure + throws before any assignment; invalid batch never half-applies.

## Cleanup candidates surfaced (NOT P1 scope)

- `McpToolRequestValidator.validatePartial` builds a stripped field-by-field result that no caller consumes (return discarded at stage 01); strict `validate()` has zero callers and its Zod schema (no `.passthrough()`) would strip unknown params if ever adopted — latent trap for future params.
- Pre-existing `import-x/order` finding in prompt-engine.schema.ts:16 (predates P1).
- (Carried from plan) write-only `context.state.session.chainContext` — 2 writers, 0 readers.

## Tier acceptance log

| Tier | Agent                     | Gate command                                                                     | Result                                                                                                              | Accepted                                                                                                                                                                              |
| ---- | ------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | sonnet abca3254           | typecheck && generate:contracts && validate:contracts                            | exit 0 all three                                                                                                    | yes — spot-check inline (see D2); buildCoreFields placement judged correct (observations not gate-scoped; union addition non-breaking); manager.ts stub anticipated (throws until T3) |
| T2   | sonnet abca3254 (resumed) | typecheck + per-file eslint A/B counts                                           | exit 0; zero new lint errors (measured)                                                                             | yes — row 6 correctly a no-op with traced evidence (validatePartial return discarded; strict validate() has 0 callers); second upstream build site found + wired (see D4)             |
| T3   | opus aaa03e12             | typecheck && test:match "unknown"                                                | 22/22 pass (re-run main thread: 22/22)                                                                              | yes — both delegated semantics accepted (see rulings); 191-line processor, single transition-rule owner, cap + atomicity tested                                                       |
| T4   | opus aaa03e12 (same)      | typecheck && build && verify:mcp                                                 | 12/12 checks; lint:ratchet + tests:ratchet + validate:arch clean                                                    | yes — stage-16 placement deviation judged correct (D5); DI at pipeline-builder.ts:277                                                                                                 |
| T5   | sonnet abca3254 (resumed) | typecheck && lint:ratchet                                                        | clean, no regressions                                                                                               | yes — buildUnknownsSection at :720, both call sites (:146, :405); P0 banner hunks verified untouched                                                                                  |
| T6   | sonnet abca3254 (same)    | full final gate (typecheck, lint:ratchet, tests:ratchet, test:ci, validate:arch) | test:ci 2037 passed / 2 failed — exactly the 2 pre-existing foreign response-assembler-cta failures; all else clean | yes — row 12 folded into T3's integration file (7/7 pass, re-run main thread); smoke assertion, docs ×2, changelog verified inline                                                    |

## Scope check (main thread, final)

`git status` classification: every P1-touched file maps to a plan row or logged deviation (D4/D6/D7). Non-P1 modifications are (a) this branch's validated-but-uncommitted P0 fixes — 14-injection-control-stage.ts, judge-menu-formatter.ts, file-operations.ts, chain-operator-executor.ts (shares T5 file), 2 test files; (b) the concurrent session's foreign set (~17 files incl. response-assembler.ts, sqlite-engine.ts, package.json, scripts) — untouched by all workers. PASS.

Note: sonnet's T6 deviation 4 mis-attributed `chain-operator-executor.test.ts` to "another session" — it is OUR P0 file. Its `ConvertedPrompt` import-path observation stands regardless (pre-existing, ratchet-tolerated).

## Additional cleanup performed (same-PR, mechanical)

CHANGELOG.md carried FOUR stale empty `## [Unreleased]` headers from past release tooling (lines 136/371/474 + the section the worker correctly created at top). Removed the three stale ones; exactly one real section remains.

## Remaining (blocked on operator reconnect of the MCP server)

1. Apply staged verification template (P0 close-out) → delete staged file.
2. Optional: delete 3 orphaned sub_agent_functionality_chain nested prompts.
3. Final live drive: real chain run submitting observations — discover → visible active → resolve → visible resolved in returned context text.
