---
title: "Client Install CTA Correction"
date: 2026-08-12
status: done
tags: [docs, readme, install]
---

# Client Install CTA Correction

**Status:** COMPLETE
**Date:** 2026-08-12

## Intent

Replace unreliable one-click installation claims with accurate setup navigation for the two primary
plugin clients, Claude Code and Codex.

## Scope

| Tier | Change                                               | Completion evidence                                                                             |
| ---- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| T1   | Replace VS Code and Cursor hero install badges       | Hero has Claude Code and Codex setup links with no one-click claim                              |
| T2   | Add a stable Codex setup target                      | The Codex badge resolves to explicit Codex instructions                                         |
| T3   | Correct surrounding README copy                      | No text says the removed buttons install via `npx`                                              |
| T4   | Amend charter policy                                 | Setup navigation and verified installers have distinct labels and evidence requirements         |
| T5   | Correct `readme_improver` through `resource_manager` | No hardcoded VS Code/Cursor MCP deeplinks remain; generation requires current official evidence |
| T6   | Validate integration                                 | README validator, formatting, resource reload, and targeted searches pass                       |

## Constraints

- Preserve unrelated worktree changes.
- Do not call a navigation badge an installer.
- Do not publish an external install URL without current official documentation and a live check.
- Modify prompt resources only through `resource_manager`.
- Remove the obsolete path in the same change; no dual CTA remains.

## Validation

```bash
cd server
npm run validate:readme
npm run validate:gate-index
npm run typecheck
```

Also verify the two fragment targets and search the README and `readme_improver` for the removed
deep-link patterns.

## Closeout

- The legacy VS Code and Cursor CTA path is removed; no dual install claim remains.
- Claude Code and Codex badges are setup navigation, not simulated installers.
- The Codex link resolves to the explicit `codex-install` target.
- `readme_improver` treats installation URLs as external contracts and requires current official
  evidence plus an end-to-end check before using installation language.
