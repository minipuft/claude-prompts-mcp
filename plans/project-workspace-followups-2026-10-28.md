---
title: Project-workspace follow-ups
date: 2026-10-28
status: active
type: plan
publish: none
tags: [resources, config, cli, hooks]
---

# Project-workspace follow-ups

## Now (2026-10-28)

Goal: every reader of `config.jsonc` applies the server's six-step order; a `.claude-prompts/` created while the server runs becomes the write root and the precedence winner at once; a system-message update writes the yaml pointer with the file; gemini-prompts spells the framework operator `^`.
Slice: rows 1–3 on `feat/project-workspace-followups` (sixth branch of the stack, above #519), row 4 in gemini-prompts on a linked worktree and its own PR. Owner pulled all four on 2026-10-28 ("is 2 acceptable? shouldn't 3 also write the pointer? fix the @ mentions").
Next decision: none open.
Constraint: `publish: none` until the rows land; shared tree in this checkout, planner commits per row.

## Rulings

| Id  | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | The standard for every reader is the server's order: `--config` / `MCP_CONFIG_PATH`, `<project>/.claude-prompts/config.jsonc` then `.json`, `<workspace>/config.jsonc` then `.json`, packaged. The project directory is `CLAUDE_PROJECT_DIR`, else cwd (`deriveProjectDir`). `cpm config` writes to the file it would read; with none present it creates the project file when `.claude-prompts/` exists, else the workspace file. |
| R2  | A late-created `.claude-prompts/` moves the write root and the precedence without a restart: the resolver's cached type paths are invalidated when the project directory's existence changes, and the loaders re-resolve their roots on the reconciliation the observer already runs.                                                                                                                                              |
| R3  | A `system_message`-only update on a prompt without one writes `system-message.md` and the `systemMessageFile:` pointer in one write; a failed post-write verification bumps no version.                                                                                                                                                                                                                                            |
| R4  | gemini-prompts keeps `@` working (the server does); its docs and manifest spell `^`.                                                                                                                                                                                                                                                                                                                                               |

Rows, each a defect or gap with its probe:

| Row | Task                                                                                                                                                                                                                                                                          | Artifact check                                                                                                                | Status                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | `cpm config` (`cli-shared/config-operations.ts`), the version-history scope (`cli-shared/version-history-scope.ts`) and the Python hooks read a project `config.jsonc` with the same precedence the server applies; `src/index.ts` workspace-config probe follows             | each reader has a test that a project config value is seen                                                                    | ☐ (as of 2026-10-28 · flips when the three readers' tests pass)     |
| 2   | A `.claude-prompts/` created while the server runs becomes the write root and the precedence winner without a restart (today only new ids hot-load; the type getters cache their primary at first use)                                                                        | the late-root integration test gains the same-id and write cases                                                              | ☐ (as of 2026-10-28 · flips when both cases pass without a restart) |
| 3   | A `resource_manager update` carrying only `system_message` for a prompt without one writes the file AND the yaml pointer; the post-write verification passes and no version is bumped on failure (`file-operations.ts` `writesYaml`, measured 2026-10-18 on 18 of 21 updates) | a test plants a prompt without a system message, updates with only `system_message`, asserts the pointer and the verification | ☐ (as of 2026-10-28 · flips when the test passes)                   |
| 4   | gemini-prompts spells the framework operator `@` at `GEMINI.md:12` and `gemini-extension.json:4`; both become `^` (that repo's own PR)                                                                                                                                        | `rg "@CAGEERF\|@framework" <gemini-prompts>` is empty                                                                         | ☐ (as of 2026-10-28 · flips when the gemini-prompts PR merges)      |
