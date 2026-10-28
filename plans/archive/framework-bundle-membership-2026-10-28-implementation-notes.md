---
title: Framework bundle membership notes
date: 2026-10-28
status: done
plan: framework-bundle-membership-2026-10-28.md
tags: [frameworks, resources, cloudySky]
---

# Framework bundle membership — implementation notes

## 2026-10-28 — opened and row A

- Source: owner ruling 2026-10-28 ("finalize the framework removal and migration"), scheduled right after the hero cut and the PR split (#515–#518). Fifth stacked branch `feat/framework-bundle-membership` above #518.
- Row A measured before deleting: with the stale shipped list and the directories gone the registry crashes (`FATAL: Framework 'liquescent' not found`), which is why the list and the move are one change; a fresh scope with `defaultFramework: "RADIANT"` and no radiant anywhere was already a named refusal naming the setting (the message said "Persisted" for a scope with nothing persisted; now "Active"); a persisted selection that is gone falls back to the configured default with a warn naming both. Control: radiant under the project's `.claude-prompts/` starts with RADIANT active, 8 frameworks listed.

## Deviations

- DEV-A-1: the refusal message text changed though the row only required a refusal to exist; nothing quoted the old wording.
- DEV-A-2: row A updated the `shipped-frameworks.ts` header prose that B5 also listed; B5 told to skip it.

## Findings

- F1 (row A): stale "8 frameworks" counts outside the row's files — `tests/e2e/conformance/{tool-surface,prompt-engine-surface,frameworks}.yaml`, `scripts/validate-conformance-coverage.js:8`, `framework-draft-validator.ts:86`, `docs/reference/mcp-tools.md:102`, `docs/portfolio/case-study.md:32` — handed to B2 and B4. cloudySky has no `.claude-prompts/config.jsonc`, so nothing pins its default to RADIANT; the config example that named RADIANT needs a bundled id (B5).
- F2 (row A): `resources/prompts/development/strategic_worker/prompt.yaml:52` names RADIANT in a comment; a bundled prompt is edited through the MCP tools, not by hand — left.

## 2026-10-28 — rows B1–B5 and closure

- B1–B5 ran as five parallel workers on disjoint files (one over the default spawn cap, accepted because the files were disjoint and the tree guard was the only cross-talk: it printed other workers' edits at teardown, never a failure of the file under test). Every B row chose `scamper` where a second bundled framework with guards was needed; B2 found that the guidance filter only strips a line naming a framework that is still bundled, so a free-text twin would not have proved the case.
- Closure: all six rows terminal; plan retired to `plans/archive/`; `publish: push` under the owner's 2026-10-28 ruling.
