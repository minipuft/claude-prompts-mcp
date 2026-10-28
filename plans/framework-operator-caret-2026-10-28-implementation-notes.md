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

(none yet)
