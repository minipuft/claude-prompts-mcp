---
title: "Client Install CTA Correction — Implementation Notes"
date: 2026-08-12
status: reference
tags: [docs, readme, install]
---

# Client Install CTA Correction — Implementation Notes

## Deviations

None.

## Validation Ledger

| Check               | Status | Evidence                                                                                                              |
| ------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| README validation   | Pass   | `npm run validate:readme` — 366 lines, charter checks passed                                                          |
| Fragment targets    | Pass   | `#claude-code-recommended` heading and explicit `#codex-install` anchor present                                       |
| Badge rendering     | Pass   | Both Shields endpoints returned HTTP 200 with `image/svg+xml`                                                         |
| Resource correction | Pass   | `readme_improver` updated to version 2 through workspace `resource_manager`, hot-reloaded, and inspected              |
| Stale-link search   | Pass   | No legacy VS Code redirect, Cursor MCP deeplink, or `One-click install` claim remains in README or authoring guidance |
| Formatting          | Pass   | Prettier check passed for changed public docs and plan files                                                          |
| Gate index          | Pass   | `npm run validate:gate-index`                                                                                         |
| Typecheck           | Pass   | `npm run typecheck`                                                                                                   |
| Lint ratchet        | Pass   | `npm run lint:ratchet` — no regressions                                                                               |

## Growth

The user correction was recorded in the global observations ledger. Because it corrects an active
workflow rule rather than proposing a general preference, it was also promoted immediately to the
README charter and the `readme_improver` evidence gate. No new framework or skill was created.
