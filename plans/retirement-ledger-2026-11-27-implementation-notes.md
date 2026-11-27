---
title: "retirement ledger — implementation notes"
date: 2026-11-27
status: backlog
tags: []
---

# Retirement ledger — implementation notes

## Rulings

| Id  | Date       | Ruling                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | 2026-11-27 | Owner: every spelling the product still accepts with a note is refused in 6.0.0: the `@` framework sigil, the script-tool fields `mode`, `confidence` and `parameter_match`, the gate operator `=`, the flat skills-sync `exports` list and the `<workspace>/<type>/` layout.                                                                                                                  |
| R2  | 2026-11-27 | Owner: the places these refusals are held are tracked in one record, automated where possible, so each refusal retires after a period instead of staying forever. Planner's design under the ruling: a ledger entry per retirement with a `forgetAfter` date, a gate that joins entries to refusal sites, a warning from the date, a failure at the first major release after it (D2, D3, D5). |
| R3  | 2026-11-27 | Planner default, flips if the owner names another period: a refusal lives six months from the release that began it (D4).                                                                                                                                                                                                                                                                      |
| R4  | 2026-11-27 | Planner, correcting its own recommendation of the same day: no `cpm` upgrade command. R33 (owner, 2026-09-15) ruled against one and scheduled the in-memory translation's removal for 6.0.0; row 2.6 carries that removal out and refuses an unversioned file with every old key named.                                                                                                        |
| R5  | 2026-11-27 | Planner: `@deprecated` tags on internal TypeScript symbols are outside this plan. Internal exports are not in the public contract; `knip` owns dead ones. The gate reads user-facing docs and string literals only.                                                                                                                                                                            |

## Findings

| Date       | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-27 | Audit of `main` at `c2d83a83`. 33 of 49 user-facing docs carry history wording (176 matches for removal, rename and deprecation words); `docs/architecture/sqlite-persistence.md` is the heaviest and is contributor-facing. `server/README.md` uses `@CAGEERF` or `@ReACT` in all three framework examples and `^` in none; the root README uses `^` only. `MCP_RESOURCES_PATH` appears in one user-facing line (the refusal row) and in six source comments that narrate the old behaviour. `codex-prompts` still lists the variable first in its README; draft PR 7 fixes it. `gemini-prompts` is clean. |
| 2026-11-27 | `config-file-translation.ts` states "it is removed in 6.0.0" in its header (R33). No open plan row carried that removal: the plan that made the ruling is `reference`. This is the stale-open-marker case of `plan-hygiene.md`, living in code prose. Row 2.6 closes it and the ledger is what keeps the next one from being prose.                                                                                                                                                                                                                                                                         |
| 2026-11-27 | Blast radius, owner's profile (`~/.claude/claude-prompts`), read only: no script tool uses `mode`, `confidence` or `parameter_match` (two `mode: audit` matches are chain `inputMapping` values, not tool fields); no `@<framework>` operator in any prompt; no legacy-layout folder at the profile root. Shipped `server/skills-sync.yaml` uses `registrations`. Shipped resources use none of the refused spellings.                                                                                                                                                                                      |

## Deviations

| Id  | Date | Row | Deviation |
| --- | ---- | --- | --------- |
