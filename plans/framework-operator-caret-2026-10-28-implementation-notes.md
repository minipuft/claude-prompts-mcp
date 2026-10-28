---
title: Framework operator caret notes
date: 2026-10-28
status: active
plan: framework-operator-caret-2026-10-28.md
tags: [parsers, hooks, docs, contracts]
---

# `^` framework operator — implementation notes

## 2026-10-28 — opened

- Source: owner ruling in chat 2026-10-28 after seeing `^ReACT` in the retake: `@` overlaps the file/mention sigil in the harnesses; make `^` the operator and ship it before the demo.
- Measured before cutting (`rg`, 2026-10-28): docs 24 sites across 8 files (mcp-tools 7, README 6), hooks 7 render/doc sites in `prompt-suggest.py` plus tests, server `src`/`tooling` ~15 strings including the operator registry, 18 test files spelling `@`, bundled resources 0; `^` already appears in the parser README, the generated tool description, the planner and the framework stage.
- Classify: feature-shaped change to a public contract spelling, additive (alias kept) → not a breaking change; strategy discovery → pre-flight → implement → validate; primary skill /search → /refactoring.

## Deviations

(none yet)

## Findings

- F2 (row 1.1): no deprecation reaches the reply today — the gate `=` deprecation and the 4.x config notice log only; `context.diagnostics` and the parse result's `metadata.warnings` have no reader. R2 corrected. `operators.json` declares a `$schema` file that does not exist. `tests/integration/gates/judge-selection-reentry.test.ts` still says the menu tells clients `@<framework>` (it now says `^`; the test passes as alias proof).
- F3 (row 1.1): two gate tests pinned the bundled gate count at 26; the creed-fidelity move (project-workspace row 2.3) made it 25 and that row's check did not include them. Fixed in `c16bf4fd`.

- F1 (row 1.4, 2026-10-28): downstream `@` framework spellings — gemini-prompts `GEMINI.md:12` (`>>prompt @CAGEERF`, reaches the model as prompt text) and `gemini-extension.json:4` (manifest description `@framework`); opencode-prompts 0; codex-prompts 0. No downstream renders the operator: gemini-prompts and codex-prompts take `hooks/lib` as a symlink into the `claude-prompts` npm dependency (row 1.2 reaches them on the next release sync), opencode-prompts has a TypeScript port with no operator text. Follow-up row belongs in gemini-prompts' plan: two spelling changes, decide whether its docs name the `@` alias.

## 2026-10-28 — row 2.1 take recorded

- Take 5 (sonnet) against the dist built from `62371444` with the hook at `d910e294`: the trace pane prints `^ReACT` on the typed line, the operators line (`chain (2 steps) | ^ReACT | gates: ver…`) and the gate-enforce line; no `@ReACT` anywhere in either cast. Again a real retry: `failed · exit 1` on the first answer, `passed · exit 0` on the second, step 2 opened in that call; the model ran no tests and narrated it ("Gate failure: The first npm test run failed … I fixed both and the second run passed. I wrote the first version without reading the tests", "The review approved the change", "I didn't run the tests myself"). Markers (real s): open 0.0 · status 6.8 · author 14.4 · run 23.6 · verdict 38.4 · complete 59.5 · end 64.5. Final-scene highlights re-matched to the new wording; rendering.
  (none yet)
