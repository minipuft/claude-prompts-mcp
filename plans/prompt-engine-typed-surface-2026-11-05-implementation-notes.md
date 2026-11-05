---
title: "prompt_engine typed surface — implementation notes"
date: 2026-11-05
status: backlog
tags: []
---

# prompt_engine typed surface — implementation notes

## Rulings

| Id  | Date       | Ruling                                                                                                                                                                                                              |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | 2026-11-04 | No MCP `instructions` block. Owner asked that anything broadcast be scrutinised and that tools feed the right pattern themselves. Every candidate fact was already carried by a description, a refusal or a footer. |
| R7  | 2026-11-04 | Owner chose one tool with its input discriminated by mode, for maintainability, after asking what it would cost.                                                                                                    |
| R8  | 2026-11-04 | Owner: fold the shape change into the open 6.0.0 release rather than cutting 7.0.0.                                                                                                                                 |
| R9  | 2026-11-05 | Owner: one language for chains. `-->` stays because it composes naturally in one line, and it must be only an operator that reaches the same underlying chain system, not something the services carry.             |
| R2  | 2026-11-05 | Settled by R9: `inputs` becomes the first node's arguments, and an undeclared key is refused by name. Not separately ruled by the owner; recorded as the planner's design under R9.                                 |

## Findings

| Date       | Finding                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-04 | Tool metadata listed per session: `prompt_engine` 22,228 bytes, `resource_manager` 27,055, `system_control` 7,910, read from `server/tooling/contracts/*.json`.                                   |
| 2026-11-04 | Consumers of the flat shape: 8 hook files with 138 field reads, 3 files in `gemini-prompts`, 9 in `opencode-prompts`, 54 server source files outside the schema, 10 footer sites, 125 test files. |
| 2026-11-05 | The string is the internal canonical form today: `workflow-command-builder.ts` compiles a submitted node object into the string-shaped `ParsedCommand`.                                           |
| 2026-11-05 | Leak past the parsers: 21 files know the string's operator types, 23 know the node model, 22 places branch on a command's origin.                                                                 |
| 2026-11-05 | Authorship of `>>a --> >>b`: 1 bundled resource file, 5 docs files, none in the owner's library or skills. Runtime use is not countable: the execution record has no column for the command form. |
| 2026-11-05 | The pre-push lint ratchet inherits the shell's Node. Under nvm's default 26 it reported two `import-x/order` regressions on a `main` that CI had green; under the pinned 24 it passed.            |

## Operator-to-node mapping

Filled by row 0.3.

## Deviations
