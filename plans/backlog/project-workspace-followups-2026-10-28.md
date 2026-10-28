---
title: Project-workspace follow-ups
date: 2026-10-28
status: backlog
type: plan
publish: none
tags: [resources, config, cli, hooks]
---

# Project-workspace follow-ups

Rows left open when the project-workspace plan retired on 2026-10-28, each a defect or gap with its probe. Pulled into a slice when the owner schedules them.

| Row | Task                                                                                                                                                                                                                                                                          | Artifact check                                                                                                                | Status                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | `cpm config` (`cli-shared/config-operations.ts`), the version-history scope (`cli-shared/version-history-scope.ts`) and the Python hooks read a project `config.jsonc` with the same precedence the server applies; `src/index.ts` workspace-config probe follows             | each reader has a test that a project config value is seen                                                                    | ☐ (as of 2026-10-28 · flips when the three readers' tests pass)     |
| 2   | A `.claude-prompts/` created while the server runs becomes the write root and the precedence winner without a restart (today only new ids hot-load; the type getters cache their primary at first use)                                                                        | the late-root integration test gains the same-id and write cases                                                              | ☐ (as of 2026-10-28 · flips when both cases pass without a restart) |
| 3   | A `resource_manager update` carrying only `system_message` for a prompt without one writes the file AND the yaml pointer; the post-write verification passes and no version is bumped on failure (`file-operations.ts` `writesYaml`, measured 2026-10-18 on 18 of 21 updates) | a test plants a prompt without a system message, updates with only `system_message`, asserts the pointer and the verification | ☐ (as of 2026-10-28 · flips when the test passes)                   |
| 4   | gemini-prompts spells the framework operator `@` at `GEMINI.md:12` and `gemini-extension.json:4`; both become `^` (that repo's own PR)                                                                                                                                        | `rg "@CAGEERF\|@framework" <gemini-prompts>` is empty                                                                         | ☐ (as of 2026-10-28 · flips when the gemini-prompts PR merges)      |
