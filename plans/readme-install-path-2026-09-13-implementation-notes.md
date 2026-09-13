---
title: "README install path — implementation notes"
date: 2026-09-13
status: active
tags: [docs, readme, resources, adoption]
---

# Implementation Notes — `plans/readme-install-path-2026-09-13.md`

Session voice. The reader-facing version belongs in the CHANGELOG entry and the commit subject.

## Why a worktree

The main checkout held another session's uncommitted work in `server/package.json`,
`server/scripts/run-validation-suite.js`, `server/config.json` and two more files, plus two staged plans —
two of those files are ones a new gate would touch. Created with `npm run worktree:create`, hooks verified
live, from `origin/main` at `56138c35`.

## Deviations

| ID       | What forced it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T1-1 | **Bundled by byte-identical copy, not through `resource_manager`** (CLAUDE.md §Core Principles 1). The tool writes to the highest-precedence writable root — on this machine the personal store — and has no verb that moves a resource down to the package tree; a `create` would re-materialise the files from fields instead of carrying them. The repo's precedent for moving resources between roots is P1.5/P1.6: copy, then prove byte identity. The tool is used as the verifier instead                                                                 |
| DEV-T1-2 | **The first copy attempt ran against an unsplit string.** zsh does not word-split an unquoted `$pairs`, so `cp` received all eleven paths as one name and failed, while `mkdir -p` created a directory tree literally named with those spaces under `development/`. Measured before removal: 10 directories, 0 files. Removed; re-copied with a Python script that refuses an existing destination and proves sha256 identity                                                                                                                                    |
| DEV-T1-3 | **Three probes failed their own controls before they measured anything.** A trailing space in a path list, a `cd server` that persisted between calls, and `fd` skipping hidden directories (so `~/.claude` read as empty). The gate probe reported all five gates absent from both roots; the earlier `>>readme_improver` run had rendered `code-quality` and `content-structure`, so "absent" was a broken probe rather than a finding. Re-run with `find` and Python: all five are bundled                                                                    |
| DEV-T2-1 | **`docs/guides/custom-resources.md` loses its count instead of gaining a correct one.** The plan row said "the measured count". No gate reads that file, and an ungated number is exactly how "90+" outlived P1.6 — so the sentence now names no number, and the README sentence, which `checkShippedPromptCount` does read, carries the only count                                                                                                                                                                                                              |
| DEV-T3-1 | **The mutation probe failed twice before it measured names.** `npm run test:unit -- <path>` and `--testPathPatterns` both ran the whole unit suite, because the script already passes `tests/unit` positionally and Jest ORs path patterns; each mutant's failure COUNT matched its prediction, but which test failed went uncaptured. Then direct `jest` under `bash -lc` was not on `PATH`, so there was no summary at all. Re-run as `npx jest` on the one file, behind a baseline that must read exactly 13 passed, 13 total before any mutation is written  |
| DEV-T3-2 | **The README gate's route widened from `docs` to every lightweight route after it was wired.** Measured after the first wiring: `hooks/gate-enforce.py` + `README.md` classifies `hooks`, and pre-push's hooks branch exits after `validate:python`. The CONTRIBUTING and plan-row checks share the hole; they are row 3.7, not changed here                                                                                                                                                                                                                     |
| DEV-T4-1 | **My rebaseline stamps failed `validate:all`.** I put the clause `held until the rebaseline line exists` between the as-of date and `flips when` in the open-row stamps of adoption rows 1.2–1.4; the stamp grammar is positional (`as of DATE · flips when`), so plan-row tracking read three unstamped rows — 1 of 58 steps red, attributed to this change, not another workstream. The hold moved into each task cell. Row 3.6 of this plan carried the same shape and was invisible only because an untracked plan is not graded; fixed before it was staged |
| DEV-T1-4 | **The commit was refused: two copied prompt files failed `prettier --check`.** I formatted every file I edited and treated the copies as byte-identical imports outside the formatting contract; pre-commit makes no such distinction. `review/system-message.md` gained a trailing newline; `tech_recommendation/user-message.md` gained table padding and one `*your*` → `_your_` marker. Template tokens compared identical (14) and `validate:prompts` loads all 50, so the bundle now differs from the personal store in those two files' formatting only   |

## Discovered and recorded

- **`verify:mcp` inherits `MCP_RESOURCES_PATH`.** `spawnServer` spreads `process.env` and sets
  `MCP_WORKSPACE`, but `MCP_RESOURCES_PATH` overrides the workspace for resources, so on a machine with a
  personal store the check proves the tools answer against a catalog no installed user has. Row 3.4.
- **`tech_recommendation`'s required `subject` is not a defect.** Suspected from reading the YAML;
  falsified by driving the chain. Row 1.3 is ⊘ rather than a fix — reading a schema does not say what the
  runtime does with it.

## Probe record

The fresh-install drive was a scratch script outside the repo, patterned on `verify-mcp-surface.mjs`: spawn
the built server on streamable-http with `MCP_RESOURCES_PATH` and `MCP_WORKSPACE` deleted and runtime state
in a temp dir, then `initialize` → `notifications/initialized` → `tools/call`. It listed 50 prompts with
`analysis` present, and advanced the three README commands to their ends.

## Notes a later reader would otherwise re-derive

- **The operand check matches code spans one at a time; `checkClaimCoverage` in the same file joins
  them on purpose.** Both are correct. Claim coverage asks whether a symbol appears on a line; the
  operand check asks what a delimiter operates on, and joining a table row's cells manufactures an
  operand. Do not "fix" one to match the other.
- **Ids compare lowercased.** The server lists `strategicImplement`; the gate derives
  `strategicimplement`. That is `normalizePromptId`, which the parser applies to what a user types,
  and otherwise the gate's derived set equals the clean-env server's served set exactly (50 = 50).
- **Quoting a broken stamp inside a graded notes table re-triggers the gate.** The first draft of DEV-T4-1
  quoted the stamp with its open-row glyph, and plan-row tracking read the quotation as a fourth unstamped
  row. Describe a stamp in words when the file is graded.
