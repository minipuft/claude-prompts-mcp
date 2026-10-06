---
title: "Tutorial rework — implementation notes"
date: 2026-09-11
status: reference
tags: [docs, adoption, tutorial]
---

# Implementation Notes — `plans/tutorial-rework-2026-09-11.md`

Session voice. The reader-facing version of anything here belongs in the commit subject, the
CHANGELOG, or the page itself, never in this file.

## Execution state

**Tiers A and B are BLOCKED** until `wc -l plans/adoption-conversion-2026-09-07.ledger.jsonl`
reads 2 (Sunday 2026-09-13). Nothing under `docs/` has been edited and nothing will be until that
line exists.

What ran on 2026-09-11 is the work that does NOT touch the measurement window: the two open
questions that would otherwise have to be answered live on execution day, and the drafted page held
inside this plan rather than landed in `docs/`.

## Rulings

| #    | Status                                                                                         | Ruling                                                                                                                                                                                                                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-1 | OPEN (probe stopped 2026-09-13 when its session ended, before reporting · re-run at execution) | A.2 — declare `options` in the schema, or delete §3. Default stands at delete. Held open only until the cost enumeration lands; if declaring `options` would duplicate `ArgumentValidationSchema.allowedValues`, delete becomes the ruling on the spot rather than a default                    |
| OQ-2 | RULED 2026-09-11 · REOPENED 2026-09-13 (see plan)                                              | Which bundled prompt B.2 runs. Constraint set is in the probe brief: zero required arguments, no chain, no script tool, no gate configuration, short self-evident output                                                                                                                        |
| OQ-3 | **RULED 2026-09-11**                                                                           | Claude Code only, inline. A tutorial that offers a client menu stops being a tutorial (Diátaxis: "offer choices" is the named anti-pattern). Every other client stays in the README's More Client Setups. Revisit only if the ledger's referrer field shows a non-Claude-Code client dominating |

## Why the direction ruling is recorded as a ruling and not a preference

B+A was chosen against a live counter-vector, not in its absence: 36 of 112 uniques reaching this
page is roughly 32% clickthrough from a landing page, which is strong, and a plausible reading is
that the funnel breaks AFTER the page rather than in it. That reading is not dismissed — it is made
testable by shipping adoption row 1.4 (single exit) in the same commit, so `docs/guides/gates.md`
uniques in the next window arbitrate between "the body was wrong" and "the exit was wrong" without
paying for a second rewrite.

If a later session finds this and wants to re-argue the direction: the thing that would change it is
a window where gates.md uniques rise while clone uniques stay flat.

## Deviations

| ID       | What forced it                                                                                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DEV-T0-1 | The governing plan carries no Execution Dispatch section, so `strategicImplement`'s tier→workflow compile step does not apply. Recorded rather than worked around: a dispatch table would have been authored for its own sake, and three rows do not need one. If Tier B grows past what one session holds, add the table then |
| DEV-T0-2 | Adoption row 1.2's falsifier contradicts row 1.2's task — it asks for an install link and then requires the reader not to leave the page. Resolved by ruling install inline and letting Gate B in the rework plan supersede the falsifier, rather than editing the same condition in two files where they could drift apart    |

## Findings that bind other plans

| ID   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T-F1 | `options` on a prompt argument has **two readers with different schemas and no tool writer**: `resource-indexer.ts` takes it off raw `yaml.load` output into the resource index and `hooks/prompt-suggest.py` displays it, while `PromptArgumentSchema` strips it and `resource_manager`'s explicit (non-passthrough) argument schema cannot set it. Whatever OQ-1 rules, that asymmetry outlives this docs plan and belongs to the resource-surface arc                                                                                                                                                                                               |
| T-F2 | `docs/guides/custom-resources.md:19` claims "bundled 90+ prompts"; measured 39 `prompt.yaml` after consolidation P1.6 deleted the 84 untracked personal prompts that had been inflating the visible count. Carried as row A.7 here because it sits in the same funnel, but the class is "counts that P1.6 falsified", and no gate owns that class                                                                                                                                                                                                                                                                                                      |
| T-F3 | **The README's install path ends in a command that fails for everyone but the owner.** All three documented install paths close with a `>>` command — `tech_evaluation_chain` (Claude Code, Codex), `research_chain` (Claude Desktop) — and none of those prompts is bundled. They live in `~/.claude/resources/prompts`, so the owner's machine serves them and no local check ever caught it. This is upstream of, and larger than, the tutorial: it is plausibly the real reason the adoption baseline reads "people arrive and do not stay". Carried as row B.10, but the fix almost certainly belongs to the adoption plan's README row, not here |
| T-F4 | **The bundled 39 are examples, scaffolds, chain internals and framework guidance — nothing in them demonstrates the product.** This is the same root cause as T-F3 seen from the other side: P1.6 moved the prompts worth showing out of the repo, so both the README and this tutorial reach for something the bundle does not contain. Carried as row B.9                                                                                                                                                                                                                                                                                            |

## Execution unblocked (2026-09-14)

**Owner ruling**: the owner took that week's snapshot and ruled that the rework proceeds now instead of waiting for
the rebaseline line. Publication is held by keeping the PR open until it merges alongside the claude-prompts release
PR. release-please holds only the npm package, and a merge to `main` publishes a `docs/` page on GitHub at once. No
ledger copy holds that snapshot (every checkout, branch and T3 checkpoint reads one line), so adoption row 1.1 stays
open.

**OQ-1 ruled (c), delete §3.** `ArgumentValidationSchema` declares `validation.allowedValues`
(`server/src/modules/prompts/prompt-schema.ts:48`), so declaring `options` would duplicate it. Per the ruling recorded
above, delete becomes the ruling on the spot.

**OQ-2 probe (51 bundled prompts, up from 39).** Candidates with at most one required argument, no chain, no gates and
no script tool:

| Prompt                                                                | Why it does or does not fit                                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `examples/minimal_prompt`                                             | a conformance fixture that is deliberately inert and forbids new arguments                         |
| `examples/shared_intro`                                               | a `{{ref:}}` include demo whose output is one welcome line                                         |
| `examples/test_default`                                               | a one-line test fixture                                                                            |
| `workflow/investigate_unknown`                                        | inserted by the adaptive chain policy, not run by hand                                             |
| `guidance/*`, `examples/quick_decision/*`, `examples/deep_analysis/*` | framework prompts and chain-internal steps                                                         |
| `development/review`                                                  | one required argument and real output, but it carries a gate configuration and a 112-line template |

The README's "Try it" line runs `tech_evaluation_chain`, a multi-step chain. No candidate meets the whole constraint
set, so OQ-2 goes to the owner.

**Adoption row 1.3 is already satisfied on `main`.** The Claude Desktop / MCPB path sits under More Client Setups
(first `.mcpb` at `README.md:111`), and Quick Start names only Claude Code and Codex.

**Collision noted**: worktree `claude-prompts-mcp-findings` holds uncommitted edits to `docs/guides/gates.md`, the
page B.6 links to. The rework links the file, never a section anchor.

**Tier B spine re-ruled by the owner (2026-09-14).** Asked which bundled prompt the page should run first, the owner
objected that nothing should run automatically in an MCP client: the model invokes the tools. The planner's question
had framed it as "the tutorial runs a prompt first", which read as automatic execution. Ruling: the first step is
asking Claude to write a prompt (`>>create_prompt` or plain words, the model calls `resource_manager`), then running
it with `>>`, then changing it. `create_prompt` ships in the bundle (`examples/create_prompt`, all arguments optional).
OQ-2 is moot.

**Open before dispatch: where an authored prompt is saved.** The Claude Code plugin sets
`MCP_WORKSPACE=${CLAUDE_PLUGIN_ROOT}` (`.mcp.json`), so `resource_manager` writes a new prompt inside the plugin's
install directory. If a plugin update installs into a new directory, the reader's prompt is left behind. B.7 must
state the measured behaviour.

**Finding: a prompt authored in a Claude Code plugin install does not survive a plugin update.**

- **Claude Code's plugin docs:** `${CLAUDE_PLUGIN_ROOT}` is the plugin's install directory and changes on each update;
  `${CLAUDE_PLUGIN_DATA}` is the persistent data directory. Install paths on this machine are versioned
  (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`).
- **claude-prompts' `.mcp.json`:** it sets only `MCP_WORKSPACE=${CLAUDE_PLUGIN_ROOT}`, so `resource_manager` writes a
  new prompt, and `state.db` with its version history, into that versioned directory.
- **Why the runtime root is missing:** `scripts/render-distributions.mjs` drops the canonical
  `MCP_RUNTIME_ROOT=${PLUGIN_DATA}` from the Claude Code projection, on the stated premise that Claude Code defines no
  such variable. The plugins reference now documents `CLAUDE_PLUGIN_DATA` and says the plugin path variables are
  exported to MCP server subprocesses. Whether it substitutes inline in `.mcp.json` `env` is unconfirmed.
- **The data directory exists before startup:** Claude Code creates the per-plugin directory at install
  (`~/.claude/plugins/data/<plugin>-<marketplace>/`, present and empty for plugins that never wrote), so pointing the
  server there would not trip the missing-workspace refusal.
- **Not measured:** a real plugin update. This machine loads claude-prompts from the source checkout, not from the
  marketplace cache.

The author-first spine the owner ruled makes this the reader's first experience, so B.7 and the page flow wait on an
owner decision.

## Follow-ups accepted (2026-09-14)

B.11 and B.12 merged. Closed from worker T's findings, not rows:

- **CI pins no Python version** (`ci.yml` has no `python-version`). ✗ KILLED (2026-09-14 · the runner image's Python
  sits above the hooks' 3.10 floor · revives if the image drops below 3.10 or the floor rises)
- **`validate:format` excludes `server/**`**, so bundled prompt markdown is format-checked only by lint-staged at commit.
  ✗ KILLED (2026-09-14 · formatting of bundled prompt markdown does not change what a reader or model receives ·
  revives if a bundled prompt ships formatting drift a reader can see)

## B.14 and B.16 accepted (2026-09-14)

Both merged. The owner's ruling covered the four documentation gates only: `intent-quality` (no activation) and
`content-structure` (activation lists `general`) still attach to a `general` prompt, so the page's generic mention of
review criteria stays true.

Closed from worker T's findings, not rows:

- **A gate update cannot be previewed** (`preview-action.ts:29` allows `delete` and `rollback` only). ✗ KILLED
  (2026-09-14 · a missing capability rather than a defect, and nothing the tutorial teaches updates a gate · revives if
  the gates guide teaches readers to change a gate, or a shipped gate change needs a review before it writes)
- **`validate:gate-index` ignores the generated date line**, so every regeneration changes it. ✗ KILLED (2026-09-14 · a
  one-line cosmetic diff no gate fails on · revives if a date-only diff blocks a gate change)
- **`server/resources/gates/_index.md` is ignored by `server/.prettierignore` but not by the root one.** ✗ KILLED
  (2026-09-14 · CI's `validate:format` excludes `server/**`, so no gate formats it from the root · revives if a root
  format gate starts covering `server/**`)

## Probe M: what Claude receives, and a write into the owner's library (2026-09-14)

**Measurement (B.13).** One `claude -p` session, six turns, a renamed throwaway plugin. Every `resource_manager` result
reached the model as `structuredContent` only; the readable text did not. The diff reached it through
`structuredContent.diff`, and `prompt_engine` text arrived intact. The model inferred "nothing written" and version
numbers from JSON fields. Print mode also collapsed the confirmation step, and the plugin's `UserPromptSubmit` hook never
fired, while its `SessionStart` hooks did, so B.15 needs an interactive session.

**Incident: the probe's server wrote into the owner's personal library.** `release_note` was created and then updated
three times (versions 0–4) under `~/.claude/resources/prompts/documentation/`.

- **Mechanism, measured in `/proc/<pid>/environ`:** `~/.claude/settings.json` has a top-level `env` block with
  `MCP_RESOURCES_PATH=/home/minipuft/.claude/resources`, which Claude Code applies to every MCP server it spawns. An
  `env -u` on the `claude` command cannot remove it, and it overrides the plugin's `MCP_WORKSPACE`.
- **The planner's first hypothesis was wrong.** Every tool call used the probe plugin's prefix; the owner's regular
  plugin never loaded.
- **Detection:** worker T noticed the folder only because it checked the library after its tests.
- **Cleanup:**
  - The planner removed the untracked `release_note` folder, and `~/.claude` resources status is clean.
  - M removed the probe worktree, branch, data directory, temp directory and session transcript directory.
  - `installed_plugins.json` and `known_marketplaces.json` changed hash during the session and hold no probe content,
    consistent with Claude Code's plugin sync when a `--plugin-dir` session starts.
- **For the next Claude Code probe:** isolate the settings `env` layer as well as the shell. A per-session settings
  override that empties `MCP_RESOURCES_PATH` would do it, since the server treats an empty value as unset; that flag
  still has to be verified.

## B.17, B.18 dispatch and the B.18 live drive (2026-09-14)

**Dispatch.** Worker N (sonnet) took B.18 on `fix/gate-update-keeps-guidance-newline`. Worker V (opus) took B.17 on
`fix/update-preview-shows-written-files`. Both branch from `origin/main` and each gets its own PR, like B.19.

**B.18 root cause (worker N, `72c14ff7`).**

- `GateDefinitionLoader.inlineReferencedFiles` trimmed `guidance.md` on load.
- The update fallback `guidance || existingGate.getGuidance()` wrote that trimmed text back.
- Fix: the loader reads the file verbatim, as the prompt loader already does.
- N's enumeration, six load-and-write-back sites: only the gate site was broken. Frameworks got a regression test with a
  mutation control. Prompts were already covered by the write-scope tests.
- `style-definition-loader.ts:374` trims the same way but has no writeback path, so it is out of the class.

**Planner acceptance probes.** 23/23 tests, typecheck OK, knip at 1194, guard steady.

**Consequences sent back to N.** The loaded text now keeps its newline everywhere it is read:

- (a) version-history snapshots are compared by JSON equality, and snapshots recorded before the fix hold trimmed
  guidance, which may add an extra version, or a one-byte-short rollback;
- (b) the skills-sync source hash includes `guidanceContent`, which may cause a one-time false drift report;
- (c) rendered guidance joins may gain a blank line per gate.

**Live drive, positive control.** Script: seed a copy of the bundled `api-documentation` gate under a new id in a
scratch `MCP_WORKSPACE`, start the server over Streamable HTTP with `buildServerEnv`, call `resource_manager` gate
`update` with only `activation`, then compare `guidance.md` bytes and confirm `gate.yaml` changed. On the pre-fix build
(`3e577ce5`):

- the update succeeded and `gate.yaml` carried the new activation;
- `guidance.md` went from 308 to 307 bytes and no longer ends with a newline;
- nothing was written into the package tree, and the personal library stayed clean.

The same drive on N's final branch is the PR-boundary check.

## B.18 follow-up: consequences of the verbatim load (2026-09-14)

**Worker N's measurements** (`b49e5d2c`):

- (c) The only rendered path, `GateGuidanceRenderer.formatGateGuidance`, doubled the blank line between gate sections.
  The fix trims for display only, and the test failed before the fix.
- (b) Skills-sync producers read guidance raw, independently of `GateDefinitionLoader`, so there is no drift.
- (a)(1) The first post-upgrade update of a gate versioned before the fix records one silent bridge row, and the diff
  shows no guidance change.
- (a)(2) A rollback to a pre-fix snapshot writes the trimmed text, so `guidance.md` is one byte short again.

**Planner ruling (a):**

- Close (a)(2) at the gate file writer, which every create, update and restore passes through. It appends exactly one
  newline when non-empty guidance lacks one, and leaves newline-terminated content unchanged.
- N recommended normalizing at each rollback call site. Rejected, because the writer covers every write path at once.
- (a)(1) is accepted as one-time debt, and the PR body names it for reviewers.

**Finding triage:** `GateActivationResult.guidanceText` (`gate-loader.ts:155`, `gate-provider-adapter.ts:92`) has no
reader in `src`. ✗ KILLED (2026-09-14 · a write-only field with no observable effect, outside the newline class ·
revives if a reader of `getGuidanceText()` appears or knip reports the field).

## B.17 handoff and acceptance so far (2026-09-15)

**Worker V (`b55e9bd5`, 11 files).**

- `FileOperations` plans each prompt write before the transaction. `projectPromptWrite` exposes that plan, and
  `ObjectDiffGenerator.generateFileChangeDiff` turns it into one diff across the changed files.
- The update preview, the update's reported diff, the version `diff_summary` and the prompt rollback preview all read
  that projection. `generatePromptDiff` is deleted.
- The response shape is unchanged, and no contract was regenerated.
- Falsifier: `preview-matches-write.integration.test.ts`, 8 of 8. Mutation A, the single-YAML update preview, failed 6
  tests; mutation B, the snapshot rollback preview, failed the rollback test.
- V stopped at its bound. Gate and framework rollback previews and update diffs are row B.20.

**V's findings, triaged:**

- B.20: gate and framework diffs.
- B.21: an update of a single-file prompt may write a second copy.
- B.22: a `parent/..` chain step scaffold, measure first.
- B.23: 2 errors of slack in the tests typecheck baseline, joined with the formatting-scope and CLAUDE.md drift.
- B.24: the `compare` label, killed.

**Planner corrections on V's branch (`46dc6f8c`).** V reported test comments naming the old writers, and a first rename
went wider than the code supports. `createOrUpdateYamlPrompt` still exists; it now writes what `planPromptFiles`
decided. So:

- the comments about the `writesYaml` gates now name `planPromptFiles`;
- the `argument-contract` line says `planPromptFiles` is where `prompt.yaml` content is built;
- the historical P7-F2 note describes "the prompt.yaml builder" without naming a function.

**Before drive (main `868f36ec`, rebuilt dist).** Script: copy `create_prompt` into a scratch `MCP_WORKSPACE`, then
send a one-line `patch` first as `action:"preview"` with `preview_action:"update"`, and then as `update`, over
Streamable HTTP.

- The preview names `create_prompt.yaml` and shows the edit as an indented YAML line (`-  # Prompt Authoring`).
- The update changes `examples/create_prompt/user-message.md`, so `previewMatchesDisk` is false.
- The preview wrote nothing, and the package tree is unchanged.

The same drive on the merged B.17 branch is the PR-boundary check.

## Publication, #284's CI failure, and B.17 acceptance (2026-09-15)

**Publish overstep.**

- The planner opened #284 (B.18) after the owner's approval had named only #281 and #283, while this plan had no
  `publish:` field.
- The planner raised it, and the owner ruled `publish: push+merge` for this plan's server-fix PRs, now in the
  frontmatter. The tutorial docs PR stays held until #232.
- Ledger line logged.

**#284's first CI run failed at "Classify validation scope".**

- Cause: `git diff --check` found `CHANGELOG.md:60: leftover conflict marker`.
- This repository sets `merge.conflictStyle=diff3`, and the planner's scripted union resolver split only on
  `<<<<<<<`, `=======` and `>>>>>>>`. It kept the `||||||| e52e8eb1` line and the base hunk.
- Prettier passed, because a marker line is valid Markdown.
- The four jobs that assert classification (Lint & Validate, CLI, Build, Test Suite) failed with it.
- Fix `91729ad7`: CHANGELOG rebuilt from `origin/main` plus N's one bullet; the diff against main is +1/-0,
  `git diff --check` is clean, and no marker of any style remains.

**B.18 pre-PR cleanups (planner).**

- `2e4d37a0`: the writer's helper comment, and test titles no longer carry ruling labels.
- `219890af`: four test comments cite `tutorial-rework B.18` instead of an id no plan file has, and the CHANGELOG bullet
  about the renderer's blank line is dropped, because that regression existed only inside this unreleased change.
- Final checks: 34/34 touched tests, `validate:all` 58/58.
- Live drive on the merged build: `guidance.md` 308 → 308 bytes, same hash, `gate.yaml` changed.

**B.17 acceptance probes (planner, V's branch `46dc6f8c`).**

- Integration `preview-matches-write` + `prompt-patch-update`: 26/26.
- Unit `resource-manager`: 267 passed, 1 skipped.
- typecheck OK, `validate:arch` OK, knip at 1194, guard steady.
- The PR boundary (main merge with the CHANGELOG rebuilt from main, then suite and preview drive) runs after #284
  merges.

## B.17 PR boundary (2026-09-15)

**Merge.**

- `origin/main` (with #284) merged into V's branch at `dbf1c871`.
- CHANGELOG rebuilt from main plus V's one bullet: +1/-0 against main, `git diff --check` clean, no marker of any
  style. This follows the rebuild procedure adopted after #284.

**Suite.** Every step exited 0:

- build and typecheck;
- `lint:ratchet` at 3092/896;
- `typecheck:tests:ratchet` at 366;
- `test:all` (3104, 830 and 209 passed);
- `validate:all` 58/58;
- `build:prod`, `start:test`, `verify:package-artifact`, `validate:tool-schemas` and `verify:mcp` 18/18.

`node_modules` stayed healthy and the personal library stayed clean.

**After drive on the merged build.**

- The preview names `examples/create_prompt/user-message.md` with `-# Prompt Authoring` /
  `+# Prompt Authoring (edited by preview drive)`.
- The update changes that same file, so `previewMatchesDisk` is true.
- The preview wrote nothing, and the package tree is unchanged.
- Before, on main `868f36ec`, the preview named `create_prompt.yaml`.

**PR.** #285 was opened under the plan's `publish:` ruling, with the title linted by commitlint first.

## B.7 handoff and acceptance (2026-09-15)

**Worker T2 (`c0779664`, page only, +24/−10, 276 lines).**

- `### Where your prompt is saved` shows the receipt under `<plugin data>/resources/prompts`, adds the
  `Current version: 0` line the server prints, and defines `<plugin data>` as
  `~/.claude/plugins/data/claude-prompts-minipuft`.
- It says an update replaces the install folder but keeps the data folder.
- Section 5's paths moved under `<plugin data>`.
- Measured drives:
  - `create` and `inspect` against a scratch data folder;
  - a second install root on the same folder still listing, rendering and keeping the history of `release_note`;
  - a hot-reload edit showing up in 4.1 s;
  - a single-file prompt in the data folder loading.

**Planner acceptance.**

- The diff touches only the page; no old path remains; Prettier passes.
- Plan vocabulary in added lines: 0. Session links: 0.
- Merged into the tutorial branch at `67e727e3`, with `git diff --check` clean and no markers.

**Ruling:** the receipt excerpt keeps `Current version: 0`, because it matches what the server prints. If B.25 changes
the numbering, the excerpt changes with it.

**T2's concerns, recorded:**

- The published 4.0.1 plugin (`origin/dist` `c91b1de9`) still sets `MCP_WORKSPACE=${CLAUDE_PLUGIN_ROOT}`, so the page
  is true only after a release publishes #281. The tutorial PR is held until #232 anyway.
- The page assumes the default `~/.claude` config folder.
- Prompts created under 4.0.1 are not migrated, as #281's CHANGELOG entry already says.

**T2's findings, triaged:**

- Version numbering for a new prompt (create → 0, first update → 2, with a mislabelled bridge v1): row B.25.
- The two renders carried different gates. Explained, no defect: B.14's `activation.prompt_categories` lines exist only
  on this branch (0 hits on `origin/main` for all four documentation gates), and T2's second server ran main's gate
  files.

## Rulings for B.20–B.23 before dispatch (2026-09-15)

The owner asked for B.20–B.23 to be launched and finished, each through its own PR under the plan's `publish:` ruling.

- **B.20:** gate and framework writers plan their files like the prompt writer (`projectPromptWrite`). The rollback
  previews and the update responses diff through `generateFileChangeDiff`. The two open entries in
  `preview-matches-write.integration.test.ts` are removed, and any snapshot-diff path left without callers is deleted
  in the same PR. The response shape does not change.
- **B.21:** measure first. If the duplicate reproduces, an update of a single-file `{category}/{id}.yaml` prompt
  converts it to the directory layout in the same write: it removes `{id}.yaml` and writes `{id}/`, and the plan and
  preview show both. Rejected alternative: a second single-file writer, which is a second write path to keep in step.
  If the duplicate does not reproduce, the row is killed with the drive as evidence.
- **B.22:** measure first. A chain step `promptId` whose remainder is `.`, `..` or any path leaving the parent's
  directory is refused by name at write, not skipped, and the scaffold path goes through `resolveContainedPath`.
- **B.23:**
  1. Extend `validate:format` to every tracked server `json`/`md`/`yml`/`yaml` file, resolving the server's Prettier
     config and `server/.prettierignore`. The gap measured with the server config is 6 files: `gates/config`
     shell-presets and verdict-patterns, `gates/test-suite/guidance.md`, `strategic_worker/system-message.md`,
     `triage/user-message.md` and the `workflow-ir.yaml` fixture. Prompt and gate content changes through
     `resource_manager`, and the others directly. CLAUDE.md states the scope the gate enforces.
  2. Re-measure the tests typecheck baseline so it has no slack.
  3. CLAUDE.md principle 5 stops naming `validate:arch` separately.
  4. Fold in the stale `validate:no-crosslayer-reexport` citations the config-consolidation session relayed (now ESLint
     `claude/no-compat-reexport-shim`).
  5. PR #288 edits `server/package.json` and `server/scripts/run-validation-suite.js`; the planner merges main after
     #288 lands.
- **B.21 and B.22** both edit `file-operations.ts`, in different functions, on separate branches. They merge one after
  the other, with the CHANGELOG rebuilt from main each time.

## Dispatch of B.20–B.23, and #286 against B.14 (2026-09-15)

**Dispatched from `origin/main` `b3e8df31`:**

- G (opus): B.20, `fix/gate-framework-diffs-name-written-files`
- S (sonnet): B.21, `fix/single-file-prompt-update-writes-one-copy`, measure first
- C (sonnet): B.22, `fix/chain-step-scaffold-containment`, measure first
- D (sonnet): B.23, `chore/validation-contract-drift`

Each works in its own worktree under the rulings above. The briefs tell workers to search siblings with `rg` directly,
because T2 and N reported that a forked `/search` with no query cost a call for nothing.

**#286 (`b3e8df31`) against B.14.**

- #286 makes a gate with no `activation` block opt-in.
- B.14 gave the four documentation gates `activation.prompt_categories: [documentation]` on this branch. After #286
  they still attach to documentation prompts and to nothing else.
- #286 changed none of those four gate files (0 files), so the next main merge into this branch should not conflict
  there. B.14's drive expectation (a `general` prompt gets none of the four) still holds.

**Owner's checkout:** rebuilt at `b3e8df31` (01:24), `verify:mcp` 18/18. A validation session started before then ran
the 00:42 build without #286.

## B.20 handoff and rulings (2026-09-15)

**Worker G (`9f15c91f`, 8 files).**

- `GateFileWriter` plans `gate.yaml` and `guidance.md` (`planGateWrite`, with `ensureTrailingNewline` applied inside
  the plan) and exposes `projectGateWrite`. `FrameworkFileWriter` does the same for all four files and the bundled
  copy-up.
- The gate and framework rollback previews, update diffs and `diff_summary` call `generateFileChangeDiff`. The four
  snapshot-diff call sites are deleted, and `generateObjectDiff` remains only in the three `handleCompare` methods.
- The coverage test has no open entries left, and a scan fails if `generateObjectDiff` is called outside
  `handleCompare`. It passes 14/14. Mutations A (gate rollback) and B (framework rollback) each fail their rollback
  test and the scan.
- G also cut the now-false last sentence of #285's CHANGELOG bullet.
- No live server drive, so the PR boundary adds one (`/tmp/gate-rollback-drive.mjs`).

**Planner rulings on G's concerns:**

- `FileContentChange` stays under `resource-manager/prompt/analysis/`. `ObjectDiffGenerator` is already imported from
  there across managers, `validate:arch` passes, and moving it would widen this PR. Revisit if a boundary rule flags it.
- `diff_summary` counts for new gate and framework versions now count file lines, as prompts did after #285. Accepted,
  and named in the PR body.

**Findings triaged:**

- B.26: framework error messages name the package folder.
- B.27: the framework writer ignores `phasesFile` and `judgePromptFile` names.
- Knip baseline slack (exports 489→487, duplicates 1→0 on G's branch): not tightened per branch, because each merge
  deletes more. B.23's branch re-measures and tightens the knip baseline on main after B.20–B.22 merge.

**Boundary script revision.** G's branch edits an existing CHANGELOG bullet. The rebuild in `/tmp/boundary.sh`
inserted only added bullets, and on a conflicted merge it would have left main's old text beside G's edit. The running
B.22 boundary keeps using `/tmp/boundary.sh`, since editing a script bash is still reading can corrupt the run.
`/tmp/boundary2.sh` adds two rules:

- an added bullet whose bold title matches a bullet the branch removed replaces it in place;
- the removal check allows only lines the branch itself removed.

## B.22 PR boundary and the B.23 handoff (2026-09-15)

**B.22 boundary** (worker C `61498a55`, plus the planner's comment rewrite `7d152337`, which removed a dated
measurement story and a "see concerns" pointer no code reader can resolve):

- Suite: every step exits 0, `test:all` 3112, 833 and 209 passed, `validate:all` 58/58.
- Live drive on `/tmp/chain-drive.mjs`:
  - On main `b3e8df31`, a fresh create with step `<parent>/..` reported "Prompt Created" and wrote
    `escape-dd/prompt.yaml` and `escape-dd/user-message.md` outside the parent. `<parent>/.` was rolled back with
    "Mutation produced invalid resource state", which does not name the step.
  - On the branch, both are refused naming the step, and nothing is written.

**B.23 handoff (worker D, 4 commits on `b3e8df31`).**

- `a4cc26e2`: `validate:format` and `format` run a second pass from `server/` with the server config and ignore file.
  - Two gate config YAMLs and the conformance fixture were formatted directly.
  - `test-suite/guidance.md`, `strategic_worker/system-message.md` and `triage/user-message.md` were changed through
    `resource_manager`. Each is byte-identical to Prettier's output.
  - CLAUDE.md and CONTRIBUTING.md now state the two-pass scope.
- `122d88f7`: the tests typecheck baseline was re-measured from 368 to 366 errors. `command-parsing-stage` went 18 →
  16; no key rose.
- `538f8b31`: CLAUDE.md principle 5 now says `validate:arch` runs inside `validate:all`.
- `267b2c14`: the `no-crosslayer-reexport` citations in CLAUDE.md, `domain-ownership.ts` and `gate-spec.schema.ts` now
  name the ESLint rule. The eslint "Ported from" comments stay as history. AGENTS.md is regenerated from CLAUDE.md by
  `sync-project-guidance.js`.

**D's notes:**

- AGENTS.md is 32709 of its 32768-byte budget.
- `git diff -w` is not empty for the three MCP-edited files, because an inserted blank line and a table separator's
  dash count do not count as whitespace. Byte identity with Prettier's output is the stronger check, and it was used.
- A write through a server with `MCP_WORKSPACE` at the repository root created a stale top-level `resources/`
  overlay; D caught and removed it.
- A guidance-only gate update rewrote `gate.yaml`; D reverted it. That is row B.28.
- `.husky/commit-msg` strips `Co-Authored-By: Claude` trailers by design, so commits here carry no trailer.

**Triage:** B.28 opened (the gate writer's write scope). B.29 killed (a comment in `verify-mcp-surface.mjs`).

## B.21 follow-up, the merge plan, and before drives (2026-09-15)

**Worker S's cross-category follow-up (`cb0712df`).**

- Measured first: updating `general/one_file_note.yaml` into `docs` kept the file and wrote `docs/one_file_note/`, so
  the full catalog listed the prompt under both categories.
- `findExistingPromptFile` now scans every category, like `findExistingPromptDirectory`. The same write deletes the
  file and writes the directory in the new category.
- One new test, whose mutation (a target-category-only lookup) fails it. The CHANGELOG bullet was extended, not
  duplicated.
- S's sandbox could not reach github.com, so S could not fetch; the planner's fetches update the shared `origin/*` refs.

**Merge plan.**

- A trial merge of B.21 against B.22 conflicts in `file-operations.validation.test.ts`: both append a new `describe`
  block at the same place, and the resolution keeps both.
- B.20 and B.21 both change `preview-matches-write.integration.test.ts`.
- Order: B.22 (#289) → B.20 → B.21. S merges `origin/main` into B.21 after B.20 lands and resolves both test-file
  conflicts. B.23 goes last, after the knip baseline is re-measured on main.

**Before drives on main `b3e8df31`.**

- `/tmp/gate-rollback-drive.mjs`: after one guidance edit, the gate rollback preview named `rollback_probe/gate.yaml`,
  while the rollback changed `rollback_probe/guidance.md`.
- `/tmp/single-file-drive.mjs`:
  - `flat_same`, same-category update: the response said "Created prompt", and the prompt ended as
    `general/flat_same.yaml` plus `general/flat_same/`.
  - `flat_move`, update into `docs`: `docs/flat_move/` was written, `general/flat_move.yaml` remained, and the catalog
    listed the id twice.

**Titles, linted clean:**

- B.20 "a gate or framework diff names the files its write changes";
- B.21 "updating a single-file prompt leaves exactly one definition of it";
- B.22 "a chain step cannot scaffold outside its parent prompt's folder";
- B.23 "the validation gates match the text that describes them".

## #288 lands; B.20 PR boundary (2026-09-15)

**#288 merged** (`e84bf394`, another session's config-contract work). It touches `CHANGELOG.md`, `server/package.json`,
`run-validation-suite.js` and five server source files, and `validate:all` is now 59 steps.

- #289 (B.22) went `BEHIND`, and `gh pr update-branch 289` merged main on GitHub without conflict (head `a1945589`).
- B.23 against main: a trial merge is clean, since #288 and B.23 edit different `server/package.json` lines.
- With the server config, the same 6 server text files fail Prettier on `e84bf394` as before, so #288 added none.
- The owner's checkout build (01:24, `b3e8df31`) is stale again; it gets rebuilt once the queue settles.

**B.20 boundary** (`/tmp/boundary2.sh`, branch `9f15c91f` merged with main at `724146f3`):

- CHANGELOG merged without conflict; the single line removed against main is the one G removed.
- Suite: every step exits 0, `test:all` 3117, 839 and 209 passed, `validate:all` 59/59.
- Live rollback drive: on the branch, the preview names `rollback_probe/guidance.md` and the rollback writes that same
  file. On the main checkout build, still the 01:24 `b3e8df31` build, the preview names `rollback_probe/gate.yaml`
  while the rollback writes `guidance.md`.
- PR #290 opened under `publish:`. It will need a GitHub-side branch update after #289 merges.

## Owner ruling: launch B.25–B.28 (2026-09-15)

The owner asked "are we just waiting", then chose to launch all four newly found rows.

- **B.25:** creating a prompt records it as version 1, so its first update is version 2 with no bridge row. The class
  covers gates and frameworks too, since each create path records no version today. Both version-history writers (the
  server's `VersionHistoryService` and `cli-shared/version-history.ts`) must agree. The tutorial receipt excerpt's
  `Current version: 0` becomes `1` when B.25 lands. The "era transition" bridge stays for resources recorded before the
  change.
- **B.26, B.27, B.28** under the rulings in their rows.

**Sequencing.** All four branch from `origin/main` after #290 (B.20) merges. B.20 rewrote the framework and gate
writers and the gate and framework lifecycle and versioning processors that B.25 (gate and framework creates), B.26,
B.27 and B.28 edit. Branching before it would build each fix on replaced code.

**In parallel:**

- S merges main (with B.22) into B.21 now and resolves the `file-operations.validation.test.ts` conflict; one more merge
  follows after #290.
- B.23's boundary runs now on main with #288 and B.22, and only the knip re-measure waits for B.20 and B.21.

## B.20 merged, B.23 and B.21 at the boundary, B.25–B.28 launched (2026-09-15)

- **#289 (B.22)** merged at `53bed1fa`, after `gh pr update-branch` took in #288 without conflict. The worktree is
  removed; 127 added lines are present on main, and the `e84bf394` control missed 77.
- **#290 (B.20)** merged at `fed35e2f`, after a second GitHub-side branch update for B.22. The worktree is removed;
  638 added lines are present, and the `53bed1fa` control missed 468. A concurrent fetch raced the planner's
  `refs/remotes/origin/main` lock, but the ref had already reached `fed35e2f`.
- **B.23:** the boundary on `b6f7df33` passed everything, with `validate:all` 59/59. After merging `fed35e2f`, the
  knip baseline was re-measured from 1194 to 1191 findings (duplicates 1→0, exports 489→487, nothing rose) in commit
  `26e15b60`, and `validate:all` re-ran 59/59. PR #291 is open. The suite row in its body names both trees.
- **B.21:** S merged `53bed1fa` (`95381dec`: kept both `describe` blocks in `file-operations.validation.test.ts`) and
  then `fed35e2f` (`bb633ba3`: CHANGELOG is main plus one bullet; `preview-matches-write` merged on its own with every
  B.20 case). Knip on the branch is 1190, one below main's new 1191 baseline, so B.21's merge leaves one finding of
  slack for the next re-measure. The boundary run with `/tmp/single-file-drive.mjs` is in progress.
- **B.25–B.28 launched** from `fed35e2f`, one worktree each: E `claude-prompts-mcp-create-version`, F
  `claude-prompts-mcp-framework-error-path`, H `claude-prompts-mcp-framework-file-names`, K
  `claude-prompts-mcp-gate-write-scope`.
  - E and K touch `gate-lifecycle-processor.ts` (create path and update path), and F and H touch framework-manager
    (lifecycle processor and file writer), so their merges go one after another.
  - The briefs tell workers that `.husky/commit-msg` strips `Co-Authored-By` trailers by design, and that their sandbox
    may not reach github.com.

## B.21 PR boundary (2026-09-15)

`/tmp/boundary2.sh` ran on `bb633ba3`, which was already level with main. `git diff --check` was clean and CHANGELOG
removed no main line.

- **Suite:** every step exits 0; `test:all` 3124, 839 and 209 passed; `validate:all` 59/59.
- **Live drive, `/tmp/single-file-drive.mjs`, on the branch:**
  - `flat_same` (updated in `general`) ends as `general/flat_same/` only, with "Converted prompt 'flat_same' from
    single-file layout … Updated prompt";
  - `flat_move` (updated into `docs`) ends as `docs/flat_move/` only, and the catalog lists it once.
- **Same drive on the main checkout build (still the 01:24 `b3e8df31` build):**
  - `flat_same` ends as the file plus the directory, reported as "Created prompt";
  - `flat_move` leaves `general/flat_move.yaml` beside `docs/flat_move/`, and the catalog lists it twice.
- PR #292 opened under `publish:`. #291 and #292 share no files, but main's up-to-date rule means whichever merges
  second takes a GitHub-side branch update first.

## B.23 merged; B.26 at PR; B.28 and B.27 handoffs (2026-09-15)

- **#291 (B.23)** merged at `002182c4`, and B.23 is ✓. The worktree is removed; its own commits added 1706 lines, all
  present on main, and the `fed35e2f` control missed 81. #292 (B.21) went `BEHIND` and was updated on GitHub; CI is
  re-running.
- **B.26 (worker F, `a07d2e94`).** Framework `reload` and incomplete-rollback messages now resolve their folder through
  `FrameworkFileWriter.resolveExistingFrameworkDir` / `getFrameworkDir`, and the private `frameworkDir()` is deleted.
  - Two tests; a mutation restoring the server-root path fails both.
  - The planner removed a history sentence ("until B.26 … `9e229e1e`") from the comment in `199d4558`.
  - Boundary: every step exits 0, `validate:all` 59/59.
  - Live drive, `/tmp/framework-error-drive.mjs`: on the branch the reload error names
    `<workspace>/resources/frameworks/probe-fw/framework.yaml`; on the main build it names
    `<server>/resources/frameworks/...`.
  - PR #293, updated on GitHub after #291.
  - F's findings opened B.30 (script tools and styles in `prompt-executor.ts`) and B.31 (skills-sync source roots); both
    are measure-first and not launched.
- **B.28 (worker K, `901834fc`)** reproduced the rewrite. A guidance-only update of a hand-written `gate.yaml` dropped
  its comment, reordered its keys and restyled `[code]`.
  - Fix: `planGateWrite(data, suppliedKeys)`. `gate.yaml` is planned only when a field that lives in it is supplied,
    or when the gate has no local `gate.yaml` yet; create and rollback still write both files.
  - Two tests, with a mutation run.
  - K's feedback became memory `feedback_byte_identity_hand_authored_fixture`. B.20's guidance-only test seeded its
    gate through the writer, so it could not see the rewrite.
  - Boundary chain `/tmp/k-chain.sh` rewords the "Row B.28" test labels to "tutorial-rework B.28" and uses
    `/tmp/gate-write-scope-drive.mjs`.
- **B.27 (worker H, `4e534b76`).** `planFrameworkFiles` writes phases and judge-prompt content to the names
  `framework.yaml` declares, through `resolveDeclaredFileName` with a containment check, and falls back to the defaults.
  - Five tests, four of which fail under the mutation.
  - Control drive `/tmp/framework-names-drive.mjs` on the main build: a description-only update created stray
    `phases.yaml` and `judge-prompt.md`. A `judge_prompt` update wrote `judge-prompt.md`, left `custom-judge.md`
    unchanged, and rewrote `judgePromptFile` to `judge-prompt.md`.
  - Boundary chain `/tmp/h-chain.sh` runs after B.28's.
- **Boundary order,** one full suite at a time: B.26 (done), B.28 (running), B.27, then B.25 when worker E hands off.

## B.21 merged; B.28's knip failure at the boundary (2026-09-15)

- **#292 (B.21)** merged at `648e88e6`, and B.21 is ✓. The first cleanup check reported 32 lines "missing on main".
  - That check summed the added lines of every non-merge commit on the branch, and S's second commit (`cb0712df`)
    rewrote lines its first commit had added.
  - The corrected check: the local tip is an ancestor of the PR head `e18002d4`, the PR head's tree equals the merge
    commit's tree, and all 33 "missing" lines are absent from the branch's own tip (superseded), with 0 lost.
  - The worktree was removed only after that.
  - For a branch with several content commits, compare the PR head's tree with the merge commit, not per-commit
    additions.
- **B.28 boundary** (after rewording the test labels in `49432de2`, merged with main at `af747a2a`):
  - every step exited 0 except `validate:all`, where knip reported `exports: baseline=487 current=489 (+2)`;
  - the cause: #291 tightened main's knip baseline after K branched. K's `GATE_YAML_RESIDENT_KEYS` and
    `ALL_GATE_DATA_KEYS` were exported but used only inside `gate-file-writer.ts`, and K's row check passed against
    the branch's older 489 ceiling;
  - fix: both are now module-private, knip is back to 1191 OK, typecheck is clean and gate-manager passes 25/25;
  - live drive `/tmp/gate-write-scope-drive.mjs` on the branch: the guidance-only update left `gate.yaml`
    byte-identical with its comment kept, and the diff named only `guidance.md`. On the main build it rewrote
    `gate.yaml` and dropped the comment. The activation-only control changed `gate.yaml` on both;
  - worker E was warned to measure against main's tightened baseline, and memory `feedback_ratchet_ceiling_slack` has
    the inverted shape.
- **Planner scripting slips.**
  - The format-fix chain's diff guard read unstaged changes, but the first attempt had already staged the export
    removals, so it stopped on a correct tree. Rerun with `git diff HEAD`.
  - A `nohup … &` launch has no completion notification, so a tracked watcher now waits for its exit line.

## B.26 merged; B.25 handoff and its before drive (2026-09-15)

- **#293 (B.26)** went `DIRTY` after #292 merged: both added a CHANGELOG bullet at the top of Fixed, so GitHub could not
  update the branch.
  - A local merge in F's worktree fast-forwarded to the remote head and merged main, rebuilding CHANGELOG from main
    plus B.26's bullet (1 inserted).
  - `git diff --check` was clean and no main line was removed.
  - Framework tests 75/75 and `validate:all` 59/59 passed, then push, CI 9/9, and merge at `a14491c9`. B.26 is ✓.
  - The first worktree cleanup failed because the merge commit had not been fetched. After fetching, #293's head
    `cb5d6fa5` has the same tree as `a14491c9`, and the worktree is removed.
- **B.25 handoff (worker E, `adc7a318`, 11 files).**
  - Prompt, gate and framework creates call `saveVersion` inside the writer's `commit:` step, so a persistence failure
    aborts the create.
  - E's own measurement found that a raw create payload does not match the post-write read-back, so the first update
    still bridged. Gates needed `ensureTrailingNewline` exported, and prompts needed `normalizeReloadShape` moved to
    module scope. Frameworks already matched.
  - `validate-mutation-atomicity` now counts `saveVersion`.
  - `cpm create` never writes version history, so there is no CLI change.
  - 394 targeted tests pass, and knip is 1191, equal to main's tightened baseline.
- **Planner acceptance.**
  - A per-rule ESLint diff of E's changed files found one new `import-x/order` error in
    `framework-lifecycle-processor.ts` (48 → 49). It passed `lint:ratchet` because the ceiling (3200) has slack.
  - E applied `eslint --fix` and then hit the account session limit before committing. The planner verified the diff
    only moves the import line, `import-x/order` is 0, and `lint:ratchet` is 3092, then committed `2534e0f5`.
- **Before drive, `/tmp/create-version-drive.mjs`, on the main build (01:24):**
  - the prompt create receipt reports version 0;
  - for prompt, gate and framework alike, one update leaves history at versions 1 and 2, one of them a bridge row.
- **Merge order from here:** #294 (B.28) and #295 (B.27) each catch up with main and merge. Then E merges main into
  B.25 once, resolving `framework-lifecycle-processor.ts` against B.26, the gate writer and lifecycle files against
  B.28, and `gate-framework-versioning.integration.test.ts` against B.26. Then B.25's boundary runs with the create
  drive.

## B.28 merged; B.25's main merge started ahead of B.27 (2026-09-15)

- **#294 (B.28)** was `BEHIND` after #293. `gh pr update-branch` merged main on GitHub without conflict (head
  `e275d8d8`), CI passed 9/9, and it merged at `9e87964c`. B.28 is ✓.
  - Worktree removed after the PR-head check: the local tip `ef057606` is inside `e275d8d8`, whose tree equals
    `9e87964c`.
- **#295 (B.27)** is catching up with main through the same script, `/tmp/h-catchup.sh`: GitHub-side update if
  possible, otherwise a local merge with CHANGELOG rebuild, framework tests and `validate:all`, then CI.
- **Worker E resumed after the rate-limit reset** to merge `origin/main` (`9e87964c`, with B.26 and B.28) into B.25
  now, not after #295.
  - B.27 changes only `framework-file-writer.ts`, which B.25 does not touch, so #295 adds at most a CHANGELOG
    conflict, which `/tmp/boundary2.sh` rebuilds.
  - E's brief names each conflict and keeps both sides:
    - `framework-lifecycle-processor.ts`: B.26's resolved-folder messages plus E's `commitOptions` and version-1 record;
    - `gate-file-writer.ts`: B.28's private write-scope sets plus E's exported `ensureTrailingNewline`;
    - `gate-lifecycle-processor.ts`: B.28's update-path `suppliedKeys` plus E's create-path record;
    - `gate-framework-versioning.integration.test.ts`: B.26's describe block plus E's cases;
    - CHANGELOG: main plus one bullet.

## B.27 merged; B.25 at the PR boundary (2026-09-15)

- **#295 (B.27)** took a GitHub-side update (head `0e65ea40`), passed CI 9/9 and merged at `e19dcba2`. B.27 is ✓. The
  worktree was removed after the PR-head check: `eb0cb828` is inside `0e65ea40`, whose tree equals `e19dcba2`.
- **Worker E merged `9e87964c` into B.25** (`16a33d86`). Only CHANGELOG conflicted: main plus one bullet. The four
  overlapping source and test files merged without markers, but two semantic breaks followed.
  - `3febcee5`: B.28 had inserted `suppliedKeys` as the second positional parameter of `writeGateFiles`, so B.25's
    create call `writeGateFiles(gateData, commitOptions)` passed the commit options into the scope slot. E reports
    typecheck clean before and after. The call is now `writeGateFiles(gateData, undefined, commitOptions)`.
  - `2441a813`: B.26's error-path test gave `handleCreate` a bare `{}` version-history service, and B.25's create calls
    `isAutoVersionEnabled()`. The fake now answers `() => false`.
  - Memory `feedback_clean_merge_signature_callers` records the rule: re-read every call site of a signature main
    changed.
- **B.25 boundary** (`/tmp/e-chain.sh`: "(row B.25)" reworded to "(tutorial-rework B.25)" in `7dff3909`):
  - suite: every step exits 0, `test:all` 3127, 845 and 209 passed, `validate:all` 59/59, lint 3092;
  - live drive `/tmp/create-version-drive.mjs` on the branch: the prompt receipt reports version 1, and prompt, gate and
    framework each show history 1, 2 with 0 bridge rows. On main `e19dcba2`: receipt 0, and a bridge row for all three;
  - PR #296 opened under `publish:`, one commit behind after #295. The catch-up (`/tmp/e-catchup.sh`) and CI are
    running.
- **After #296 merges:** tutorial receipt excerpt `Current version: 0` → `1`, the owner's checkout rebuilt, memory
  updated, and a final report to the owner covering B.15, B.30 and B.31.

## B.25 merged; the server-fix run closes (2026-09-15)

- **#296 (B.25)** took the GitHub-side catch-up (head `6c0b2b0f`), passed CI 9/9 and merged at `61b43c3f`. B.25 is ✓.
  The worktree was removed after the PR-head check: `7dff3909` is inside `6c0b2b0f`, whose tree equals `61b43c3f`.
- **Tutorial page** (`a60a329e`): the create receipt excerpt now reads `Current version: 1`, the number a create
  reports on main.
- **Owner's checkout** fast-forwarded `b3e8df31` → `61b43c3f` with no dependency file changed, rebuilt, and
  `verify:mcp` reports 18/18. The node_modules guard read `root=259 server=474 jest=y commitlint=y` before and after.
- **All twelve server-fix PRs of this plan are merged** (#281, #283–#285, #289–#296), and each is linked to the
  thread. No worktree of theirs remains.
- **Still open:** B.15 (the owner's walk), B.30 and B.31 (not launched), and a main merge into this branch before its
  PR, which stays held until #232.

## Main merged into this branch; B.30 and B.31 dispatched to measure (2026-09-15)

- **Owner:** "Did you merge the tutorial branch, if not please do so", and launch B.30 and B.31 "to see if these are
  real problems we need to address". The tutorial PR itself stays held until #232 under the `publish:` ruling, so the
  merge here is `main` into this branch, local only.
- **`70d174c8`** merges `61b43c3f` into `9774ebdf`. The branch and main changed no file in common since `975093bf`, so
  the merge had no conflict. `git diff --check` is clean, there are no conflict markers, and Prettier passes on the 13
  files the branch still changes. The branch is 0 behind main and not pushed.
- **Workers J (B.30) and L (B.31)** measure only, read-only against the owner's built `main`. Each returns a verdict,
  a site enumeration by shape, and a proposed fix scope. L runs with `HOME` a temp dir and preview mode, and runs no
  `pull` against the owner's checkout.

## B.30 and B.31 measured real; two more rows opened (2026-09-15)

- **B.30, worker J.** `prompt-executor.ts` builds the script and style folders from the package root, and
  `configManager` has no scripts or styles accessor, though `PathResolver.getScriptsPath()` and `getStylesPath()`
  exist. The planner re-ran J's drives with the workspace rebuilt (J had removed `/tmp/b30-ws`, so the first re-run
  refused to start on a missing workspace):
  - a workspace script tool fails with `Script "probe-script" not found. Searched: …/server/resources/scripts/probe-script`;
  - `#probe-style`, present only in the workspace, renders no style block, while the bundled `#analytical` renders
    `**Response Style:**` in the same run;
  - the checkout stayed clean, with no file under `server/` newer than the run.
  - Users reach both: `docs/guides/script-tools.md` documents a workspace tier `resources/scripts/{script_id}/`, and
    `cpm create style <id> -w <workspace>` writes `<workspace>/resources/styles/<id>/`. The owner's own library and
    plugin data hold no styles or scripts today.
- **B.31, worker L.** `resolveServerRoot()` never reads `MCP_WORKSPACE`, and the planner read it to confirm. L ran
  `export --preview` through `scripts/skills-sync.ts` with a temp `HOME`: a workspace prompt and a workspace gate
  resolve 0 resources, and the bundled `strategicImplement` and `code-quality` resolve 1 each. `pull` inherits the
  same source paths, and `clone` scaffolds under the same root. There is no CLI copy of the service.
- **B.32 opened, found by L and confirmed live by the planner.** `buildSystemControlSchema()` declares none of the
  skills-sync fields, so Zod strips them before the handler. The planner's drive (`/tmp/b31-strip-drive.mjs`: a copy of
  `dist`, `resources` and `skills-sync.yaml` in `/tmp`, with `HOME`, workspace and runtime root all temp) called
  `export` with `client: claude-code, preview: true`. It wrote 33 files into `.claude/skills` and
  `.config/opencode/skills`: the preview ran as a real export for every registered client. The real client skill
  folders and the checkout were unchanged afterwards.
- **B.33 opened, found by J.** `buildStyleAuxiliaryReloadConfig` has no caller, while three doc sites describe style hot
  reload.
- **The workers followed the brief.** Neither edited the repository. L chose the CLI wrapper over `system_control` on
  its own, because it doubted `preview` would survive the schema, and that doubt is what found B.32.

## B.32 is a class across `system_control` (2026-09-15)

- **Enumeration.** The planner read each tool's schema keys at runtime (`/tmp/b32-schema-keys.ts` under `tsx`: the
  `shape` of every exported schema) and compared them with the `args.<field>` reads in that tool's handlers. A first
  pass that parsed `key: z.` from the source found 13 `prompt_engine` keys and was discarded; the runtime shape has 41.
  - `system_control` declares 11 fields, and its handlers read 21 undeclared ones across six actions.
  - `resource_manager` declares 68 and reads four undeclared ones: `full_restart`, `is_chain`, `goal` and
    `include_legacy`. These are not driven.
  - `prompt_engine` reads none; its one hit is a comment.
- **Drives** (`/tmp/b32-class-drive.mjs`, a throwaway copy with temp `HOME`, workspace and runtime root):
  - control: the declared `topic` narrows `guide` to skills;
  - an injection override with `type: system-prompt, enabled: false` answers `Invalid injection type: undefined`,
    although the handler's own usage text shows that call;
  - a config restore with `confirm: true` answers `Restore cancelled`;
  - analytics history with `limit: 1` runs with the default.
  - The checkout was clean afterwards, with no file under `server/` newer than the run.
- **Failure direction.** Skills-sync export fails open: a preview writes, and the client limit is ignored. `config`,
  `maintenance` and `injection` fail closed: their operations cannot run over MCP. `analytics` and `guide` fall back
  to defaults.

## Owner ruling: fix all four, B.32 first (2026-09-15)

- **Owner:** "All four, B.32 first (Recommended)".
  - B.32 starts now with its own PR, and B.30 and B.31 run alongside it.
  - B.33 follows B.30, because style hot reload matters only once workspace styles load.
  - Each ships as its own PR under the existing `publish:` ruling, after the full local suite and a before/after drive.
- **Workers:**
  - P (B.32, opus/high) on `fix/tool-fields-reach-handlers`.
  - Q (B.30, sonnet/high) on `fix/workspace-scripts-and-styles`.
  - U (B.31, opus/high) on `fix/skills-sync-workspace-sources`.
  - Every worktree starts from `origin/main` `61b43c3f`.
- **File ownership, to keep the three branches apart:** Q owns `infra/config/index.ts` and
  `shared/types/config-manager.ts`. U resolves skills-sync roots without editing those files. P owns the three tool
  schemas, the contract JSON, the generated metadata and the `system_control` handlers.
- **Correction:** the three worktrees started from `056d5def`, not `61b43c3f`. #297 merged between the measurement and
  worktree creation. It changed no dependency file, and none of the measured defect lines: the scripts and styles joins
  in `prompt-executor.ts`, `resolveServerRoot()` and `system-control.schema.ts`. It did change `infra/config/index.ts`,
  the `prompt_engine` and `resource_manager` schemas, the input-schema snapshot and the contracts, so the workers
  build on it.
- **Count correction:** the undeclared `system_control` reads are 21 distinct names, not 20: `scope` counts once,
  though skills sync and injection both read it. Re-measured on `056d5def` with the runtime schema shapes, which also
  gave `resource_manager` 69 keys and `prompt_engine` 45.

## B.30 handoff accepted; boundary running (2026-09-15)

- **Worker Q** returned `981c7a18` on `fix/workspace-scripts-and-styles`, 8 files.
  - `ConfigManager` gains `getScriptsDirectory()` and `getStylesDirectory()`, which mirror the gates and frameworks
    accessors.
  - `PromptExecutor` builds the script loader from the first, and gives the style manager the second plus the overlay
    and bundled folders as `additionalStylesDirs`.
  - Rejected: threading `module-initializer.ts`'s style roots through `updateData()`, because `mcp/` does not import
    `runtime/`.
- **Q's evidence:**
  - with the fix stashed, 2 of the 3 new e2e cases fail and the bundled-style control passes;
  - unit 3209, integration 845, e2e 212;
  - drive: the workspace script's output renders, `#probe-style` applies, and `#analytical` still renders.
- **Planner acceptance probes:**
  - no file of P's or U's is touched, and the diff has no session vocabulary;
  - ESLint per rule on the three source files, branch against the copies still at `056d5def` in U's worktree: no rule
    increased;
  - the e2e test starts its server through the shared `startServerWithHttp` helper.
- **Noted, not blocking:** `overlayDirsFor` is a private `PromptExecutor` method that combines two `ConfigManager`
  accessors. `module-initializer.ts` derives the same roots for its startup inventory line, so there are two call
  sites over one resolver.
- **B.30 boundary** (`/tmp/boundary2.sh`, `981c7a18`, 0 behind `056d5def`):
  - every step exits 0: `lint:ratchet` 3099 errors and 895 warnings, the tests ratchet 366, `test:all` unit 3209,
    integration 845 and e2e 212, `validate:all` 59/59, `validate:tool-schemas` identical, `verify:mcp` 18/18.
  - The boundary's own drive call failed with a usage error (Q's drive takes a workspace and a runtime-root argument),
    so the planner ran the drive by hand.
- **The owner's checkout had been fast-forwarded to `056d5def` at 10:54 by a `pull --ff-only` outside this session**,
  without a rebuild; `verify:mcp` refused a `dist` 429 minutes older than `src`. The planner rebuilt it (18/18), and the
  guard stayed `root=259 server=474 jest=y commitlint=y`.
- **B.30 drive** (`/tmp/b30q-drive.mjs`, full output saved to `/tmp/b30q-accept-{before,after}.json`):
  - before, on the rebuilt main `056d5def`: the workspace script fails "not found" under `…/server/resources/scripts`,
    `#probe-style` renders no style block, and `#analytical` renders its block;
  - after, on the branch: the script's output marker renders, `#probe-style` renders its block and its guidance, and
    `#analytical` still renders;
  - both trees were clean afterwards.

## B.31 and B.32 handoffs accepted (2026-09-15)

- **B.31, worker U, `008f0ec9`, 12 files.**
  - Change: a new `runtime/skills-sync-paths.ts` resolves source roots from `PathResolver` (the
    `indexerResourceRoots` order: bundled, primary, overlays), and the skills-sync service takes those paths as a
    required argument. `skills-sync.yaml` is read workspace-first; `clone` writes to the workspace; `pull` refuses per
    resource when the source sits in the package tree; `patch` follows the runtime root.
  - Tests: 5 new integration tests, red on the unfixed service and green after; a precedence mutation fails 1.
  - Drive: a workspace prompt and a workspace gate each go from 0 resources to 1, and the bundled controls stay at 1.
  - Planner probes: no file of P's or Q's; no session vocabulary; no ESLint rule increased. The new
    `mcp/tools/skills-sync.ts` import of `#runtime/` has precedent in three `mcp/` files on `056d5def`, so the claim in
    Q's handoff that `mcp/` never imports `runtime/` was wrong.
  - Sent back for two additions:
    - `runtime/data-loader.ts` `loadSkillsSyncExports` still reads the package `skills-sync.yaml` (same class);
    - a probe of whether a `--workspace` flag without `MCP_WORKSPACE` reaches skills sync over MCP.
- **B.32, worker P, 4 commits, 20 files.**
  - `system_control` declares 22 more fields, and the skills-sync parameters move into `system-control.json`. The
    unregistered `skills-sync.json` contract and its generated file are deleted.
  - `reset_analytics` (an unconfirmed reset) is removed, `changes` reads `resource_type`, and `resource_manager`
    declares `full_restart`, `goal` and `include_legacy`, forwards `goal` and `include_legacy` to the guide, and stops
    forwarding the dead `is_chain`.
  - Correction to the B.32 row: `resource_manager` uses a passthrough schema, so its four fields were never stripped.
  - The closing check is `tests/unit/mcp-tools/tool-input-fields.test.ts`. It reads schema keys from the runtime shape
    and handler reads from the TypeScript AST. With `preview` removed from the schema, 2 of 9 tests fail.
  - Drive: a preview writes 33 files before and 0 after; `client` narrows the export; the injection override takes
    effect; a confirmed restore reaches the writer.
  - Planner probes: no session vocabulary; ESLint per rule shows 4 rules down by 1 and none up; no HTTP route reaches
    `system_control`, so the removed and renamed reads break no HTTP caller; the deleted contract is referenced only in
    a retired plan. P shares `CHANGELOG.md` and `docs/reference/mcp-tools.md` with Q, and `CHANGELOG.md` with U.
  - Ruled a fix, not a breaking change: every newly declared field was already read and was dropped before reaching
    the handler. The one tightening is that an invalid enum value or `limit: 0`, formerly dropped, now fails validation.
- **Merge order is B.30 (#298), then B.32, then B.31.** P's new e2e fixture places `skills-sync.yaml` beside
  `MCP_RESOURCES_PATH`, which B.31 stops reading, so B.31 moves that fixture when it merges `main`.

## Triage of the B.31 and B.32 findings (2026-09-15)

- **Opened B.34** (schema and contract parity beyond `system_control`) and **B.35** (the unenforced `runtime/` import
  direction).
- **Planned for B.32, then moved to B.34:** `mcp/http/api.ts` still sends `is_chain`, and `ResourceManagerInput` still
  declares it after the router stopped forwarding it. The removal completes in the same PR, after the early boundary
  run leaves P's worktree.
- **Folded into B.31, sent to worker U:** remove the `pull` guard that can never fire, and add a test for `patch`'s
  default output, which moved to the runtime root with no test.
- **Killed:**
  - ✗ Creating a workspace `skills-sync.yaml` for plugin users (2026-09-15). Nobody has asked for it, and
    `docs/guides/skills-sync.md` now states where the file is read. Revives if a plugin user needs to register exports
    and hand-creating `${CLAUDE_PLUGIN_DATA}/skills-sync.yaml` is judged too much to ask.
  - ✗ Renaming `indexerResourceRoots` now that skills sync also uses it (2026-09-15). Cosmetic. Revives when a third
    consumer appears.
- **Held for U's probe:** whether a server started with `--workspace` and no `MCP_WORKSPACE` reaches skills sync over
  MCP. It becomes a row if real.
- **P's commit body** says handlers read "25 more" fields, where the measured count is 24 distinct names. The squash
  body comes from the PR, which states 24.
- **Planner commit `a9446661` on B.32:** the `changes` filter help still named `resourceType` after the action switched
  to `resource_type`. The full unit run afterwards: 242 suites, 3214 passed.
- **Correction, same day:** the `is_chain` removal is not mechanical. `prompt-draft-service.ts` (~132) still reads
  `args.is_chain` into the draft object, and the HTTP route builds that input apart from the router. Removing it
  changes the draft shape, so it moved into B.34, which already reworks `resource_manager`'s input type against its
  contract. B.32 ships without it.

## B.30 merged; B.33 dispatched (2026-09-15)

- **#298** passed CI 9/9 (the Node 22.13.0 job took 7m04s), reached `CLEAN`, and merged at `5a5c50e2`. B.30 is ✓.
  The worktree is removed after the PR-head check. The owner's checkout was fast-forwarded to `5a5c50e2` and rebuilt.
- **Worker Y (B.33)** starts from `5a5c50e2`, so the style manager already reads the workspace and bundled folders.
- **B.32 early boundary** (`/tmp/boundary2.sh` on `a9446661`, before B.30 merged):
  - passed: build, typecheck, `lint:ratchet` (3097 errors, 893 warnings), the tests ratchet (366), `test:all` (unit
    3214, integration 845, e2e 214), `build:prod`, `start:test`, `verify:package-artifact`, `validate:tool-schemas`,
    `verify:mcp` 18/18;
  - failed: `validate:all`, 2 of 59 steps.
    - `validate:module-catalog` drifted.
    - `validate:conformance-coverage` failed two ways: 12 `skills_sync.*` parameter exceptions name parameters no
      contract advertises after the skills-sync contract was deleted, and the newly declared `system_control`
      parameters have no conformance scenario and no declared exception.
  - Sent back to worker P with a cap of 24 files; P must see 59/59 before handing off. The planner merges `main` into
    the branch afterwards, because `docs/reference/mcp-tools.md` changed on both sides.
- **B.32 drive on that run** (`/tmp/b32-drive.mjs`, a throwaway copy with a temp `HOME`), branch against main `5a5c50e2`:
  - a preview export writes 0 files against 33;
  - `client: claude-code` writes 17 files to `.claude/skills` and none to opencode, against 17 and 16;
  - the injection override is set and listed in status;
  - a confirmed config restore reaches the writer and reports `ENOENT` for the missing backup;
  - the `changes` filter by `source: external` is applied.

## B.31 addendum returned; B.36 and B.37 opened (2026-09-15)

- **Worker U** added three commits, taking the branch to 14 files:
  - `24d905fd`: `loadSkillsSyncExports` takes the server's `PathResolver` and reads the resolved `skills-sync.yaml`.
    Three new deregistration tests: 2 fail on the unchanged loader, and the package-only control passes.
  - `d48a217d`: `pull` refuses a resource with no source path, as a per-resource failure, and the guard that could not
    fire is gone.
  - `5770e38b`: `patch`'s default output is tested under `MCP_RUNTIME_ROOT`, and under the workspace when that is
    unset. Both fail on `056d5def`'s service.
- **`--workspace` probe: the gap is real.** It is now B.36, after B.32, because its seam runs through P's handler.
- **U's finding on the exported-prompt set** is now B.37, measure first.
- **U's concern about the B.32 e2e fixture:** it may need more than moving `skills-sync.yaml` when B.31 merges `main`.
  With `MCP_RESOURCES_PATH` set, the bundled tree now loads under the resources path, so any counts that fixture
  asserts can change.
- **Planner acceptance of the addendum:**
  - no file of P's or Y's is touched, and the diff has no session vocabulary;
  - ESLint on `data-loader.ts` against its copy at `056d5def`: no rule increased, and `service.ts` has 0 active
    findings;
  - `deregistration.test.ts` and `workspace-sources.test.ts` re-run green (18 tests).
- **B.31 early boundary** (`/tmp/boundary2.sh` on `5770e38b`):
  - The boundary merged `origin/main` `5a5c50e2` (B.30) into the branch as `abcc86be`, without conflict.
  - Every step exits 0 except `validate:all`: build, typecheck, `lint:ratchet` (3099/895), the tests ratchet (366),
    `test:all` (unit 3212, integration 852, e2e 212), `build:prod`, `start:test`, `verify:package-artifact`,
    `validate:tool-schemas`, `verify:mcp` 18/18.
  - The one `validate:all` failure is `validate:module-catalog`, drifted by the new `runtime/skills-sync-paths.ts`.
  - The catalog is regenerated after B.32 merges rather than now: B.32 regenerates the same generated file, and doing
    both would only produce a conflict in it.
- **Remaining B.31 steps, after B.32 merges:**
  1. The planner merges `main` into the branch.
  2. Worker U moves B.32's e2e fixture off the `MCP_RESOURCES_PATH` config location, re-checks any counts it asserts,
     and regenerates the module catalog.
  3. The boundary runs, with the CLI drive before and after.
  4. The PR opens.

## B.32 validate:all fix returned; boundary rerun with main merged (2026-09-15)

- **Worker P** returned `f6cd11d3` and `55a08594`, and the branch now changes 24 files, its cap.
  - Module catalog regenerated: 3 lines, all the new edge `mcp-tools → mcp-contracts`.
  - The 12 stale `skills_sync.*` coverage exceptions are deleted.
  - The new parameters get conformance scenarios: read-only ones on the shared server, `skills_sync` option refusals
    that never export, and state-changing ones on the isolated server, including an injection override with
    `expires_in_ms: 1`.
  - Four exceptions carry today's reasons: `system_control.id`, `system_control.backup_path`,
    `resource_manager.full_restart`, `resource_manager.include_legacy`.
  - P's evidence: coverage 115/115 covered or exempted, and claims conformance 133/133 on the branch build. The same
    scenarios on the owner checkout's `056d5def` build: 16 fail, all new rows.
- **Opened B.38** from P's finding: conformance servers inherit the developer's real `HOME`.
- **The boundary reruns** with `origin/main` `5a5c50e2` merged in. B.30 also changed `docs/reference/mcp-tools.md`.
- **Planner acceptance of P's fix:**
  - the `validate-conformance-coverage.js` diff changes only `exceptionGroup` entries: 12 `skills_sync.*` removed, 4
    added with reasons;
  - every new `skills_sync` scenario is a `diff` or `clone` option refusal, and none exports, syncs, pulls, restores or
    restarts;
  - the module catalog diff is the one `mcp-tools → mcp-contracts` edge.
- **B.32 boundary with `main` merged** (`/tmp/boundary2.sh` on `55a08594`):
  - The boundary merged `5a5c50e2` as `062901ea`; `CHANGELOG.md` and `docs/reference/mcp-tools.md` auto-merged.
  - `validate:all` 59/59, `lint:ratchet` 3097/893, the tests ratchet 366, `validate:tool-schemas` identical, and
    `verify:mcp` 18/18.
  - `test:all` exited 1 although unit (3218), integration (845) and every e2e test (234) passed. The new
    `system-control-input-fields.e2e.test.ts` failed to run with `ENOTEMPTY … /logs`: its `afterAll` sent `SIGTERM`
    without waiting for exit, then removed the workspace without retries.
  - Planner commit `b3f4eb0a` copies the #260 pattern nine e2e suites already use: `await killServer(server)`, then
    `rm(…, { maxRetries: 5 })`. The file alone passes 5/5; the e2e tier passes 13/13 suites and 234 tests.
  - The failed run's leftover workspace in `/tmp` was deleted.
  - "Jest did not exit one second after the test run" appears in every boundary log today, including B.30's, so it
    predates B.32.
  - Drive on the merged build, against main `5a5c50e2`: a preview writes 0 files against 33; `client` narrows to 17 in
    `.claude/skills` against 17 plus 16 in opencode; the injection override is set against `Invalid injection type:
undefined`; a confirmed restore reaches the writer against `Restore cancelled`; the source filter is applied.

## B.33 handoff reviewed; sent back for the baseline bump (2026-09-15)

- **Worker Y** returned `2898302a` and `54c6bff7`, 10 files.
  - Style reload is wired into `ensurePromptHotReload()`.
  - `createStyleHotReloadRegistration` watches the loader's primary and overlay folders.
  - `resolveStyleManager()` awaits the manager's background load.
  - A new 7-case integration test: 5 fail on the old code.
  - Drive: styles did not reload before and do after; the prompt-reload control is observed in both runs.
- **Planner probes:**
  - no session vocabulary;
  - the apparent overlap with P's branch (`prompt-executor.ts`, `overview.md`) comes from the B.30 merge already in
    P's branch, not from P's own edits.
  - Per rule on the 5 changed source files against the owner's checkout at `5a5c50e2`, `max-lines` rises by 1:
    `application.ts` goes from no finding to 1006 counted lines against a maximum of 1000.
  - Y had raised `.eslint-ratchet-baseline.json` by exactly that warning.
- **Ruled:** a baseline raised to absorb new debt does not land. Y reverts it and keeps `application.ts` under
  `max-lines` by restructuring; the suggested seam is a `runtime/` builder for the auxiliary-reload list, since each
  reload builder already lives in its own module. The cap is now 12.
- **Also sent to Y:** check the Gates, Prompts and Frameworks rows of the `design-decisions.md` hot-reload table for
  the bundled-path-only wording fixed for Styles.
- **Opened B.39** from Y's concern: the baseline has slack in most rules and none in `max-lines`. A regeneration waits
  until the open fix branches merge, because it would conflict with each of them.

## B.32 merged (2026-09-15)

- **#299** passed CI, reached `CLEAN`, and merged at `4d323d60`. B.32 is ✓.
- **The planner** removes P's worktree after the PR-head check, fast-forwards and rebuilds the owner's checkout, and
  merges `main` into the B.31 branch before worker U moves B.32's e2e fixture.
- **Cleanup and merge after #299:**
  - P's worktree was removed after the PR-head check (`b3f4eb0a` tree equals `4d323d60`).
  - The owner's checkout is at `4d323d60`, already fast-forwarded by a pull outside this session; the planner rebuilt it
    (`verify:mcp` 18/18).
  - The planner merged `origin/main` into the B.31 branch as `f904f25f`. Only `CHANGELOG.md` conflicted and was
    rebuilt from main plus the branch bullets.
  - The pre-commit hook regenerated contract files during that merge commit; the generated diff against main is 0
    lines, and the branch still changes exactly U's 14 files.
  - Worker U was resumed to move B.32's e2e fixture off the `MCP_RESOURCES_PATH` config location, confirm B.32's
    `skills_sync` conformance refusals, regenerate the module catalog, and show the e2e tier and `validate:all` green.
    Cap 17.
- **B.33 rework accepted:**
  - `4781e6fc` reverts the baseline to `5a5c50e2` byte for byte, and moves the five auxiliary-reload builders into
    `runtime/hot-reload-auxiliaries.ts`. `application.ts` drops from 1006 counted lines to 984.
  - `5389b888` corrects the Prompts and Gates rows of the `design-decisions.md` hot-reload table.
  - Planner probes: no rule increased on the touched files (`strict-boolean-expressions` −1), no `max-lines` finding,
    10 files, no session vocabulary.
  - Y's figures: `lint:ratchet` 3098/895, hot-reload tests 14/14, and the drive observes style reload with its
    prompt-reload control.
- **B.33 widened to the class Y found.** Framework hot reload watches only `getFrameworksDir()` while its loader reads
  more folders, the same shape styles had. Gates and styles already watch `getWatchDirectories()`, and script tools'
  watching of the workspace scripts folder from B.30 is unverified. Y was resumed to:
  - enumerate all five registrations;
  - fix each one that watches fewer folders than its loader reads;
  - add a table-driven test with a positive control on the framework row;
  - show a framework reload observed.
  - Cap 16.

## B.31 final steps accepted; boundary running (2026-09-15)

- **Worker U** added `06cdb735` and `9c20089d` on top of the planner's merge, so the branch changes 16 files.
  - The B.32 fields e2e now writes `skills-sync.yaml` into its temp workspace and drops the resources copy and
    `MCP_RESOURCES_PATH`. It fails 2 of 5 on the merge and passes 5 of 5 after, and its counts are unchanged.
  - B.32's nine `skills_sync` conformance refusals are raised in `validateSkillsSyncOptions`, before config loading:
    `verify:claims` 133/133.
  - The regenerated module catalog adds one edge, `runtime → skills-sync`.
  - U's figures: `test:e2e` 234 passed with 2 skipped, `validate:all` 59/59, `lint:ratchet` 3097/893, the tests
    ratchet 366, and `tool-input-fields.test.ts` plus `system-control-registration.test.ts` 13/13.
- **Planner probes:**
  - no session vocabulary;
  - the fixture keeps a temp `HOME` and workspace, `killServer` with an `rm` that retries, and its assertions that the
    preview writes nothing and that `client` narrows the export;
  - the catalog diff is the one edge.
- **B.38 widened** with U's finding: e2e, claims and `validate:all` runs leave gitignored state in the tree they run
  in.
- **Drive adapters for the boundary runner** (`node <script> <serverRoot> <label>`):
  - `/tmp/b31-drive.mjs` runs the CLI preview with a temp `HOME`, workspace and runtime root. It counts files per client
    skill folder, and names anything else under the temp `HOME` (on main, 6 files of npm cache under `.npm`).
  - `/tmp/b33-drive.mjs` wraps Y's three-argument drive.
  - Smoke runs on main `4d323d60`:
    - B.31: workspace prompt and gate 0, bundled controls 1, no skill files, and the checkout unchanged;
    - B.33: style reload not observed, while the prompt-reload control is.
- **B.31 boundary** (`/tmp/boundary2.sh` on `9c20089d`, 0 behind `4d323d60`):
  - every step exits 0: `lint:ratchet` 3097/893, the tests ratchet 366, `test:all` (unit 3221, integration 852, e2e
    234), `validate:all` 59/59, `validate:tool-schemas` identical, `verify:mcp` 18/18.
  - Drive `/tmp/b31-drive.mjs`, branch against main `4d323d60`:
    - the workspace prompt resolves 1 against 0, and its preview lists `SKILL.md` and the gate's `gate.yaml` and
      `guidance.md`;
    - the workspace gate resolves 1 against 0;
    - the bundled controls resolve 1 on both sides;
    - no skill files are written under the temp `HOME` on either side, and both checkouts are unchanged.
- **PR #301 opened for B.31** under `publish:`, linked to the thread, CI running.
- **Another session opened PR #300** (`feat/gate-artifacts`, "gates attach by artifact", 2026-09-15 19:10 UTC). Not
  this plan's PR, so not linked. Its files overlap two things here:
  - **B.31 (#301):** `modules/skills-sync/service.ts`, `docs/guides/skills-sync.md`,
    `docs/reference/module-catalog.md`, `tests/integration/skills-sync/export-command.test.ts`. Whichever merges second
    takes `main`; a `service.ts` conflict becomes a worker task, not a planner edit.
  - **The held tutorial branch:** `server/resources/gates/{information-placement,product-positioning-fidelity,
prose-hygiene,semantic-discoverability}/gate.yaml` and `gates/_index.md`, the files B.14 edits. The tutorial PR
    will conflict there when it opens with #232.

## B.33 watch-folder round returned; B.40 to B.42 opened (2026-09-15)

- **Worker Y** added two commits:
  - `570045ba`: framework reload watches `getWatchDirectories()`, and script-tool reload also watches the workspace
    scripts folder, clearing the executor's script cache.
  - `c2cd168c`: docs for all five registrations and the CHANGELOG bullet.
  - The new `hot-reload-watch-coverage.integration.test.ts` tables all five registrations. With the framework fix
    reverted, only the framework row fails.
  - Y's figures: `lint:ratchet` 3096/895 with the baseline identical to `5a5c50e2`, hot-reload suites 24/24, and the
    drive still observes the style reload with its prompt-reload control. Framework reload is shown by the integration
    test rather than the drive.
- **Opened from Y's findings:**
  - B.40: prompt hot reload watches only the primary prompts folder.
  - B.41: switching to a framework created in the same session makes the next `prompt_engine` call answer
    `Internal server error`.
  - B.42: the `@id` framework override ignores frameworks created after startup.
- **Planner acceptance of Y's round:**
  - 13 files, and `.eslint-ratchet-baseline.json` identical to `5a5c50e2`;
  - per rule on the touched source files, no increase (`strict-boolean-expressions` −3);
  - the coverage table names its prompts row "primary directory only", with the reason in the file header, and B.40
    tracks that gap.
  - Two comments cited "B.30" by row id, and the overview's watched-directories table had no script-tools row.
    Planner commit `fbc8ccf6` removes the row ids and adds the row. A first attempt failed harmlessly: zsh passed the
    unsplit file list to Python as one argument, the open failed before any write, and the guard stopped with the tree
    clean.
- **PR #301 went `DIRTY` after CI passed.** The other session's PR #300 merged first. Worker U was resumed to merge
  `origin/main` into the B.31 branch and resolve the conflicts:
  - keep both #300's behavior and the B.31 resolver seam;
  - regenerate the module catalog rather than hand-merge it;
  - re-read call sites of every signature either side changed;
  - show `test:all` and `validate:all` green, without pushing.
- **The B.33 boundary runs** with `origin/main` (B.32 and #300) merged and the `/tmp/b33-drive.mjs` drive.
- **B.33 boundary** (`/tmp/boundary2.sh` on `fbc8ccf6`):
  - The boundary merged `origin/main`, two commits behind (B.32 and #300), as `82782600`; only `CHANGELOG.md`
    needed a merge, and it auto-merged.
  - Every step exits 0: `lint:ratchet` 3059/890 (#300 lowered the totals), the tests ratchet 366, `test:all` (unit
    3265, integration 864, e2e 234), `validate:all` 59/59, `validate:tool-schemas` identical, `verify:mcp` 18/18.
  - Drive `/tmp/b33-drive.mjs`, branch against the owner checkout's build at `ea3865af`:
    - style reload observed on the branch and not on main;
    - the prompt-reload control observed on both.
  - The drive's framework probe reports not observed on both sides. It creates and switches to a framework
    mid-session, which runs into B.41. Framework reload is shown by the coverage test's framework case instead, and
    the PR body claims it only from that test.
- **PR #302 opened for B.33** under `publish:`, linked, CI running. The owner's checkout was rebuilt at `ea3865af`
  (another session's pull had moved it there) with `verify:mcp` 18/18.
- **Worker U resolved #301's conflict with #300:**
  - `6afa1be3` merges `origin/main` `ea3865af`. Only `service.ts` conflicted (6 hunks), and each hunk keeps both
    sides: #300's declared artifacts and `harnessCovers` alongside B.31's paths argument.
  - #300's `getServerConfigPath()` merged without a conflict but called the `getServerRoot()` that B.31 removed. The
    merge commit reads the package `config.json` through the paths argument.
  - The module catalog is main's version, regenerated; `export-command.test.ts`, `docs/guides/skills-sync.md` and
    `CHANGELOG.md` merged cleanly.
  - `84997ecf`: the export reads `gates.harnessCovers` from the server's own config path, workspace first, as #300's
    docs promise. Its new test fails on `6afa1be3`.
  - U's figures on `84997ecf`: `test:all` unit 3268, integration 858, e2e 234; `validate:all` 59/59;
    `lint:ratchet` 3062/890; the tests ratchet 366.
- **Planner probes on `84997ecf`:**
  - conflict markers: 0 in the tree, and 4 of 4 in a positive control file;
  - `git diff --check` clean; 16 files against main; no session vocabulary;
  - `service.ts` keeps both sides (21 `harnessCovers` references, 39 for the paths seam) and has no `getServerRoot()`
    call left.
  - U reported that its own first marker scan was invalid: a `--` placed before `--glob` made `rg` error, and the
    fallback printed "none".
- **The B.31 boundary reruns** on this snapshot before the push.

## B.33 merged (2026-09-15)

- **#302** passed CI and merged at `af4ff5d6`; B.33 is ✓.
- **The first merge attempt did not merge.** The guard scanned the whole `gh pr checks --watch` log, which keeps the
  earlier refresh cycles that still showed checks pending. A fresh `gh pr checks 302` showed every check passing and
  `CLEAN`, and the merge went through.
- **Y's worktree is removed** after the PR-head check.
- **The owner's checkout rebuild waits** until the B.31 boundary rerun finishes, because that run's control drive uses
  the checkout's `dist`.
- **B.31 (#301) now needs `main` again** (B.33's changelog bullet) before it merges.
- **B.31 boundary rerun** (`/tmp/boundary2.sh` on `84997ecf`, 0 behind `ea3865af` at the start):
  - every step exits 0: `lint:ratchet` 3062/890, the tests ratchet 366, `test:all` (unit 3268, integration 858, e2e
    234), `validate:all` 59/59, `validate:tool-schemas` identical, `verify:mcp` 18/18.
  - Drive, branch against the owner checkout's build at `af4ff5d6`:
    - the workspace prompt resolves 1 against 0, with the gate's files in the preview;
    - the workspace gate resolves 1 against 0;
    - the bundled controls resolve 1 on both sides;
    - no skill files are written, and both checkouts are unchanged.
- **Before the push**, `main` had moved to `af4ff5d6` (B.33). The planner merges it into the branch with the
  changelog rebuild, updates the #301 body's suite line, pushes, and waits for CI again.

## B.31 merged; the four measured fixes are closed (2026-09-15)

- **#301** passed CI on `0f5a2de8`, which merged `main` at `af4ff5d6` cleanly. Merged at `267bc610`, gated on a fresh
  `gh pr checks` and `CLEAN`. B.31 is ✓.
- **All four rows the owner launched on 2026-09-15 are merged:** B.30 (#298 `5a5c50e2`), B.32 (#299 `4d323d60`),
  B.33 (#302 `af4ff5d6`), B.31 (#301 `267bc610`). Their worktrees are removed after PR-head checks, and the owner's
  checkout is fast-forwarded and rebuilt.
- **Rows opened from worker findings, none launched:** B.34 (schema and contract parity, dead `is_chain`), B.35 (the
  `runtime/` import direction), B.36 (`--workspace` over MCP skills sync), B.37 (exported-prompt set on reload), B.38
  (conformance `HOME` and test state in the tree), B.39 (ESLint baseline slack), B.40 (prompt watch folders), B.41
  (framework switch after a same-session create), B.42 (`@id` override and new frameworks). The owner decides which to
  launch.
- **The tutorial branch** last took `main` at `70d174c8`. It is now behind by B.30 to B.33, #297 and #300; #300 edits
  the four gate files and `gates/_index.md` that B.14 also edits.

## Owner rulings: launch the bugs; merge main into the tutorial branch (2026-09-15)

- **Owner:** "Launch and delegate bugs, we'll investigate the gaps after i compact". And for the tutorial branch: "Merge
  now, worker resolves".
  - **Launched:** B.41 and B.42 together to worker A (one likely root cause: a framework created mid-session never
    reaches its dependents, measured first), B.36 to worker B, B.37 to worker X (measure first).
  - **After the owner compacts:** B.34, B.35, B.38 and B.39, the check gaps.
  - **Not launched:** B.40. The owner did not select it, so it stays open.
- **Tutorial branch:** worker Z merges `origin/main` in a separate worktree on `docs/tutorial-first-run--main-merge`,
  cut from the tutorial branch. The planner keeps committing plan writebacks in the tutorial worktree, so a worker
  there would share its HEAD. Z reconciles the gate files that #300 and B.14 both edit. The planner merges Z's branch
  back into the tutorial branch. Nothing is pushed, and the tutorial PR stays held until #232.

## Tutorial main merge staged, not committed; the B.14 gate form needs a ruling (2026-09-15)

- **Worker Z** staged `git merge --no-ff --no-commit origin/main` (`267bc610`, #297 to #302) in
  `claude-prompts-mcp-tutorial-merge`, and stopped before committing under the brief's stop rule.
- **The conflict is semantic.** #300 attaches gates by artifact: when `activation.artifacts` is present it decides
  alone, and `prompt_categories` is not read (`gate-activation.ts` ~64–71). B.14 scoped the four documentation gates
  with `activation: { prompt_categories: [documentation] }`.
- **Z's registry probe** (T means the gate attaches), with controls firing both ways:

  | Shape                              | general | documentation | documentation + docs | general + docs |
  | ---------------------------------- | ------- | ------------- | -------------------- | -------------- |
  | A, #300's `artifacts` only         | F       | F             | T                    | T              |
  | C, B.14's `prompt_categories` only | F       | T             | T                    | F              |
  - A live server on the merged build gave a `documentation` prompt that declares no artifacts none of the four
    gates.

- **Staged as A.** B.14's negative half holds: a `general` prompt such as the tutorial's `release_note` gets none of
  the four. B.14's positive half, that a documentation prompt gets them, is already lost on main since #300,
  independent of this merge.
- **Options Z named:**
  - A, commit as staged;
  - B, A plus the category lines, which the skills exporter reads as metadata only and #300's reference calls
    redundant;
  - C, B.14's form, which fails main's `artifact-activation-registry.test.ts`;
  - D, A plus the bundled documentation prompts declaring `docs` or `readme` artifacts, a separate row.
- **Checks on the staged tree:**
  - no conflict markers (control 4/4), `git diff --check` clean, Prettier clean on changed files;
  - build, typecheck, `validate:all` 59/59, `tests/unit/gates` 397, gate integration tests 175;
  - `_index.md` regenerated with no diff.
- **Tutorial page:** every statement Z checked against the merged build still holds. That covers the receipt
  (`Current version: 1`), `inspect` fields, the gates shown on a run (content-structure and framework-compliance
  reminders, none of the four documentation gates), preview and update, and the written `prompt.yaml` fields. The
  hook statements and the single-file layout were not driven.
- **Opened B.43** from Z's finding: the create reply suggests a gate `basic_validation` that does not exist.
- **Z's other finding:** main's `code-quality` names both `artifacts` and `prompt_categories`, the redundant pairing
  #300's reference warns about. Folded into whichever row handles the gate form, if the owner opens D.

## Owner ruling on the B.14 gate form; tutorial merge committed; B.36 and B.37 returned (2026-09-15)

- **Owner:** "#300's form + follow-up row (Recommended)".
  - Z's staged merge was committed as staged: the four gate files are identical to `origin/main`, with no unmerged
    paths and no markers.
  - The planner merged `docs/tutorial-first-run--main-merge` back into `docs/tutorial-first-run` and removed Z's
    worktree.
  - B.14's receipt is restated, and B.44 carries the positive half: bundled documentation prompts declare `docs` or
    `readme` artifacts.
- **Worker B (B.36)** returned `c4ea150a`, `d46b65d4` and `1237b757`, 9 files.
  - A `skillsSyncPaths` provider on the `system_control` context is set unconditionally in `module-initializer.ts`.
  - The action handler throws when the provider is missing rather than falling back to the environment.
  - A new e2e test fails on `267bc610` and passes after.
  - Drive with only `--workspace`: before, `status` reads the package `skills-sync.yaml` and the workspace prompt is
    absent; after, it reads the workspace file and the preview includes the prompt. `HOME` is empty after both.
  - B's finding became B.45: the MCP response drops the run report's counts.
- **Worker X (B.37) measured REAL.** After a prompt hot reload, a newly registered export stayed in `prompts/list`;
  the reload control and the fresh-restart control both passed.
  - `549add2b`, 5 files: `handlePromptHotReload` recomputes the exported set after `reloadPromptData`, and the
    misleading comment in `data-loader.ts` is corrected.
  - A new e2e test fails on `267bc610` and passes after.
  - `skills-sync.yaml` itself is not watched, a documented choice; a prompt edit alongside it triggers the recompute.
  - Rejected: recomputing inside `modules/prompts`, which would import `runtime/`.

## B.41/B.42 handoff; B.36 and B.37 accepted (2026-09-15)

- **Worker A measured both symptoms on `267bc610`** over HTTP and STDIO, with `@cageerf` and a `react` switch as
  controls.
  - B.42 reproduces with `Parse error: "@b41a_fw >>b41a_probe"`.
  - B.41 reproduces and is wider than reported. Over HTTP, every request answers -32603 after the switch until
    restart; over STDIO, each render fails `Active framework ... not found`.
- **The two are independent causes.**
  - B.42 was the parser's startup snapshot of framework ids. `a833566e` (8 files) gives the parser a lookup that asks
    the framework manager on every parse, and deletes the snapshot. A new e2e test fails 1 of 4 on `267bc610` and
    passes 4 of 4 after; drive after: `@b41a_fw` renders on both transports.
  - B.41 is the state store's private, bundled-only framework manager (row widened above).
- **B.41 is not committed.** A's patch (`/tmp/b41a-proposed-module-initializer.patch`) needs `module-initializer.ts`,
  which B.36 owns. Tested and reverted, it fixes the switch but breaks deleting the active framework without a removal
  step.
  - **Ruled:** the fallback is the configured `frameworks.defaultFramework`, the documented contract, not the first
    available framework.
  - B.41 continues on its own branch after B.36 merges.
- **Opened from A's findings:** B.46 (one throw while building the per-request HTTP server fails every request) and
  B.47 (an unawaited framework-system persist). B.39 now includes the knip baseline's slack.
- **B.36 accepted:** 9 files; the handler throws when the provider is missing; no session vocabulary; no baseline
  edits; no ESLint rule increased against `267bc610`.
- **B.37 accepted:** 5 files; no session vocabulary; no baseline edits; no rule increased; no `max-lines` finding on
  `application.ts`.
- **B.36 and B.37 share** `CHANGELOG.md` and `docs/guides/skills-sync.md`, so the second to merge takes `main`.
- **Both boundaries run now.** B.42's boundary waits for them, so that three concurrent full suites do not cause e2e
  timeouts.
- **B.36 boundary** (`1237b757`, 0 behind `267bc610`):
  - every step exits 0: `lint:ratchet` 3059/890, the tests ratchet 366, `test:all` (unit 3268, integration 872, e2e
    236), `validate:all` 59/59, `validate:tool-schemas` identical, `verify:mcp` 18/18.
  - Drive `/tmp/b36-drive.mjs`, a server started with `--workspace` only:
    - main: `status` answers `Config: missing (…/Applications/skills-sync.yaml)` and the preview fails "No
      skills-sync.yaml found";
    - branch: `Config: found (<workspace>/skills-sync.yaml)`, and the preview loads 1 resource with
      `workspace_flag_probe/SKILL.md`;
    - 0 files under the temp `HOME` on both sides.
  - PR #303 opened under `publish:`, linked, CI running.
- **B.37 boundary** (`549add2b`, 0 behind `267bc610`):
  - every step exits 0: `test:all` (unit 3268, integration 872, e2e 237), `validate:all` 59/59, `verify:mcp` 18/18.
  - Drive `/tmp/b37-drive.mjs`:
    - main: after registering `export_probe` and a reload, it is still listed;
    - branch: it is not listed, and after unregistering and another reload it is listed again;
    - the reload control is served on every reload, on both sides.
  - The PR body is ready. The push waits for #303 to merge, since both change `docs/guides/skills-sync.md` and
    `CHANGELOG.md`.
- **B.42 boundary** runs with `/tmp/b42-drive.mjs`, an adapter over worker A's drive that reports the `@id` step and
  its controls. Smoke on main: `Parse error` for the created framework, while the controls pass.
- **B.42 boundary** (`a833566e`, 0 behind `267bc610`):
  - every step exits 0: `lint:ratchet` 3059/890, the tests ratchet 366, `test:all` (unit 3270, integration 872, e2e
    238), `validate:all` 59/59, `validate:tool-schemas` identical, `verify:mcp` 18/18.
  - Drive `/tmp/b42-drive.mjs`:
    - `@b41a_fw >>b41a_probe` answers `Parse error` on main and renders under that framework on the branch;
    - the `@cageerf`, `react` switch and `tools/list` controls pass on both.
  - The PR body is ready.
- **Merge order from here:** B.36 (#303, CI running) first. Then B.37 and B.42 each take `main` before their push:
  B.37 shares `CHANGELOG.md` and `docs/guides/skills-sync.md` with B.36, and B.42 shares `CHANGELOG.md`. B.41 resumes
  with worker A once #303 merges, because its fix changes `module-initializer.ts`, which B.36 also changes.

## B.36 merged; B.37 and B.42 pushed; B.41 resumes (2026-09-15)

- **#303** passed CI and merged at `d59bffaf`, gated on a fresh `gh pr checks` and `CLEAN`; B.36 is ✓. Worker B's
  worktree is removed.
- **A read-only merge preview** (`git merge-tree <base> <a> <b>`; Git 2.34 has no `--write-tree`) showed:
  - B.36 against B.37 conflicting only in `CHANGELOG.md`; `docs/guides/skills-sync.md` merges cleanly;
  - B.42 overlapping both only in `CHANGELOG.md`.
- **B.37 and B.42** each take `origin/main` with the changelog rebuild, are typechecked, pushed and opened as PRs, and
  their CI covers the merged snapshot.
- **B.41 resumes with worker A** in a new worktree, `claude-prompts-mcp-framework-state` on
  `fix/framework-state-shares-registry` from `d59bffaf`, since A's first worktree holds the pushed B.42 branch. The
  fallback when the active framework leaves the set is the configured `frameworks.defaultFramework`.

## B.42 merged; B.37 CI caught a reload race (2026-09-15)

- **#305** passed CI and merged at `6fc40cbe`, gated on a fresh `gh pr checks` and `CLEAN`; B.42 is ✓. Worker A's
  first worktree, `claude-prompts-mcp-framework-propagation`, is removed: its tip is inside the PR head, and the head
  tree equals the merge tree. The owner checkout is fast-forwarded to `6fc40cbe` and rebuilt; `verify:mcp` 18/18.
- **#304 failed CI on its own new e2e test**, on Node 22.13.0 only (Node 24 green): `returns the prompt once it is
unregistered and another reload runs` still found `reload_probe_exported` missing.
  - Cause, read from the branch: `handlePromptHotReload` assigns `this._convertedPrompts` from the reload, then awaits
    `loadSkillsSyncExports`, and only then calls `setExportedPromptIds`. The per-request HTTP server factory
    (`createMcpServerFactory`) calls `registerAllPrompts(this._convertedPrompts, server)`, which publishes that content
    to the live map and registers against whichever export set is in force. A request inside the await gets the new
    content and lists against the previous export set.
  - The test's positive control (the trigger prompt's new body) observes the content, which can arrive one await before
    the export set. On a slower runner the poll lands inside that window. Not yet reproduced: the worker's first step
    widens the await with an injected delay and must see the same failure.
  - Ruling: fix the order in the server, not with polling in the test. Compute the export set before the reload assigns
    anything the per-request factory reads, then apply both with no await between. A new worker takes it (dispatch row
    X2), since X's session has ended.
- **B.41:** worker A was told #305 merged. It commits, merges `origin/main` (expected conflicts: `CHANGELOG.md` and
  `docs/guides/frameworks.md`), and re-runs its tests and #305's e2e test on the merged tree.
- **node_modules guard** with `ls -A`: `root=259 server=475 jest=y commitlint=y`. The server entry beyond the recorded
  474 is `.cache`, created 2026-09-14 22:55. Nothing in `server/node_modules` is newer than the 2026-09-14 22:27
  install, and every package directory is in the lockfile, so no install ran.

## B.37 race fix accepted; boundary running (2026-09-15)

- **Worker X2** committed `a8ba635f` on `fix/exported-prompts-refresh-on-reload`, one file (`server/src/runtime/application.ts`).
  - Reproduced first: with a 1.5 s delay between assigning `_convertedPrompts` and the export lookup, the e2e file
    failed. It failed the first round's assertion ("drops the newly exported prompt"), not the second round CI named;
    both rounds read the same race, and a fixed delay against a 500 ms poll decides which one lands in the window.
  - The fix looks up the export set from the reload result before any reloaded state is assigned, then applies the
    prompt data, `apiRouter.updateData` and `setExportedPromptIds` with no await between them.
  - With the delay still in place after the fix, the e2e file passed; without it, three clean runs. `lint:ratchet`
    3059/890 and the tests ratchet 366 are unchanged.
  - Class enumeration: startup `loadPromptData` and the manual `fullServerRefresh` both resolve the export set before
    the caller assigns `_convertedPrompts`, so neither has the gap.
- **Planner probes on receipt:** one file; no delay, plan-row ids or session vocabulary in added lines; no baseline
  edits; worktree clean.
- **Boundary** `/tmp/boundary-b37-race` is running with `/tmp/b37-drive.mjs`. `/tmp/boundary2.sh` is not executable,
  so the first launch exited 126 before any step ran; it runs through `bash`.
- **PR body** `/tmp/b37-pr-body2.md` adds the race to the summary, a verification row, and a reviewer note. It passes
  `validate-pr-body.mjs`; the suite counts are filled in from the boundary.

## B.41 handoff received; three changes sent back; hot removal opened as B.48 and B.49 (2026-09-15)

- **Worker A** committed `870cd73a` (12 files: 6 source, 4 test, docs, CHANGELOG) and merged `origin/main` (`6fc40cbe`,
  #305) as `18973f47`.
  - One framework manager remains: the router adopts the state store's manager, and its own construction fallback
    is deleted.
  - `removeFramework` awaits the state store moving any selection that named the removed framework to
    `frameworks.defaultFramework`. `resource_manager` delete and the hot-reload deletion callback both call it.
  - A drive on both transports: switching to a created framework renders and keeps `tools/list` at 3; deleting the
    active framework moves the selection to the configured default; a framework seeded before a restart switches and
    renders.
- **Probes on receipt:**
  - the worktree is clean;
  - no plan-row ids or session vocabulary in the added lines, and no baseline edits;
  - the merge's diff against `main` is exactly the 12 files;
  - `createFrameworkManager(` is called only from the state store.
- **Sent back, same branch:**
  1. Deleting a workspace framework that is also `frameworks.defaultFramework`, while active, runs `fs.rm` and
     `unregister` before `selectConfiguredDefault` can throw. The selection stays on a removed framework, which is
     the B.41 outage for that case. Ruling: refuse before any mutation, naming the setting.
  2. Startup now refuses when the persisted framework is missing and the configured default is not registered, where
     it used to pick the first framework available. Kept, as the fallback ruling applied honestly; it gets a test,
     a docs line and a CHANGELOG line.
  3. The pre-merge `lint:ratchet` read 3056/891 against main's 3059/890: one warning more. The worker names the rule
     and file from a per-rule diff of real files.
- **Hot removal is not delivered.** It is opened as two rows, neither launched:
  - B.48: auxiliary events lack `frameworkId`. B.33's framework evidence injected the id in its test and drove an
    MCP update, not a file edit.
  - B.49: removals under a folder created after startup are not reported.
- **Sightings:**
  - B.39: the knip ratchet reads exports −2, files −1 and types −2 below its baseline, on `main` too.
  - ESLint ignores `tests/**`, so a per-rule lint diff over test files measures nothing.

## B.37 boundary green; main moved again; #304 pushed (2026-09-15)

- **Boundary** `/tmp/boundary-b37-race` on `94446841` (branch plus `main` `6fc40cbe`):
  - every step exits 0: `lint:ratchet` 3059/890, the tests ratchet 366, `test:all` (unit 3270, integration 872, e2e
    243), `validate:all` 59/59, `verify:package-artifact`, `validate:tool-schemas` identical, `verify:mcp` 18/18;
  - drive `/tmp/b37-drive.mjs`: on the branch a registered prompt leaves `prompts/list` after a reload and returns
    once unregistered; on the owner build it stays listed both times; the reload control is observed in all four
    reads.
- **`main` moved to `4f28604b` (#306, another session's gates refactor)** while the boundary ran. Its only file overlap
  with #304 is `docs/guides/skills-sync.md`, and it has none with B.41. The owner checkout had been pulled without a
  rebuild, so the boundary's control drive read a `dist` built at `6fc40cbe`; both are unfixed for B.37, so the
  control stands.
- **#304** took `origin/main` again as `08383100`, merged cleanly. On that tree: build, typecheck, the tests ratchet
  366, `lint:ratchet` 3048/885 (#306 lowered the counts), and the e2e file 3/3. Pushed; the PR body now carries the
  race row and names the full-suite snapshot as the merge with `6fc40cbe`. CI covers the new snapshot.
- **The owner checkout** is rebuilt at `4f28604b`; `verify:mcp` 18/18.
- **Worker A** was told `main` moved: round 3 merges `4f28604b` first and diffs lint per rule against the owner
  checkout at that commit.

## B.41 round 3 received; round 4 sent for one live default (2026-09-15)

- **Round 3** committed `3d365b95` (7 files, all already changed by the branch) and merged `origin/main` (`4f28604b`,
  #306) as `a0579ce9`.
  - Deleting the configured default, or previewing that delete, is refused before anything is removed. The refusal
    names `frameworks.defaultFramework`.
  - The startup refusal (persisted framework missing, configured default unregistered) has a unit test.
  - Lint: the extra warning came from comparing before `main` was merged in. #305 removed a `no-unsafe-call`
    warning the pre-merge branch still had. On the merged tree the branch reads 3045/885 against the owner checkout's
    3048/885; the only per-rule difference is `strict-boolean-expressions` 18 → 15 in `framework-state-store.ts`.
  - Probes on receipt: clean; 0 behind `main`; no session vocabulary in added lines; no baseline edits.
- **The worker's divergence concern is reachable.** The config manager watches `config.json` in production
  (`runtime/context.ts:135` starts it), and `frameworksConfigChanged` compares only injection and tool-description
  fields. Meanwhile `FrameworkStateStore` and `FrameworkManager` each hold a `defaultFramework` snapshot from
  construction.
  - Failure: after `frameworks.defaultFramework` changes on a running server, the delete refusal (a live read) and
    the fallback (the snapshot) disagree. Deleting the old default while it is active removes its files and then
    throws in the fallback, which is the B.41 outage for that case.
- **Ruling:** one source for the configured default, read when used. Every reader goes through the config manager, and
  a deliberate runtime override (if `FrameworkManager` ~531 is one) keeps its meaning. A unit test and an e2e case on
  both transports edit `config.json` while the server runs, poll a delete preview until the new default is refused as
  the positive control, then delete the old default while it is active.
- **The boundary** `/tmp/boundary-b41` on `3d365b95` was stopped, because round 4 supersedes it and builds in the same
  worktree. It re-runs on round 4's commit.

## #304 green but behind; #307 landed; #304 re-merged (2026-09-15)

- **#304 CI on `08383100`** passed every job, including Node 22.13.0, where the race had failed. It was not merged:
  GitHub reported `BEHIND`.
- **`main` moved to `e50095ac`** (#307, another session: a STDIO server writes only its real warnings to stderr).
  - It overlaps #304 in `application.ts` and `CHANGELOG.md`.
  - It overlaps B.41 in `framework-state-store.ts`, `mcp/tools/index.ts`, `module-initializer.ts`, the persistence
    test, and `CHANGELOG.md`. In the state store it splits an absent row (a debug line) from a corrupt one (a
    warning).
- **#304** took it as `a1218d2f` through `/tmp/pr-remerge.sh`, a new script that re-merges `origin/main` with the
  CHANGELOG rebuild and re-runs the fast checks and one test file.
  - The merge was clean. Checks: build, typecheck, tests ratchet 364, `lint:ratchet` 3044/883, and the e2e file 3/3.
  - In `handlePromptHotReload` the export lookup (line 936) still precedes the `_convertedPrompts` assignment (943)
    and `setExportedPromptIds` (951).
  - Pushed; CI re-runs on the merged snapshot.
- **Worker A** was told #307 landed in its files: merge it (after committing round 4 if edits exist), keep #307's
  behavior and tests, re-read call sites, and diff lint against the owner checkout at `e50095ac`.
- **Stopped-boundary check:** the worktree process scan was shown to catch a known process (1 hit), then read 0 after
  it was killed, before `/tmp/b41-boundary-stopped` was created.
- **The owner checkout** is rebuilt at `e50095ac`.

## B.41 round 4 accepted; boundary running (2026-09-15)

- **Round 4** merged `origin/main` (`e50095ac`, #307) as `8894ae2b`, before any round-4 source edit, then committed
  `4c3859d5` (9 files).
  - The one conflict was the persistence test: both sides' tests were kept.
  - #307's `stdio-console-output`, `config-schema-warning` and persistence tests pass on the merged tree, 20/20.
  - The signatures #307 changed (an optional database-port argument on `McpToolRouter.initialize`,
    `createMcpToolRouter` and `PromptExecutor`) have no caller on this branch.
  - `frameworks.defaultFramework` now reaches `FrameworkStateStore` and `FrameworkManager` as `() => string`, read
    through the config manager when used, so the delete refusal and the fallback answer one value.
    `setDefaultFramework` had 0 callers and is deleted.
  - Red on `3d365b95`: the new e2e case failed at the delete on both transports, after its preview poll had proved
    the config reload.
  - Lint against the owner checkout at `e50095ac`: 3040/883 against 3044/883, reductions only.
- **Probes on receipt:**
  - 9 files; no session vocabulary in added lines; no baseline edits;
  - `setDefaultFramework` 0 callers anywhere;
  - every remaining default read is the provider.
  - The branch touches 13 files against the row's 12, the extra one a test double that passes a provider; accepted.
- **Concerns carried to the PR body:**
  - a `config.json` edit that fails to load is not measured against the fallback;
  - a scope created after an edit starts on the new default;
  - startup refuses when the saved selection is missing and the default is unregistered, where it used to pick the
    first framework. That is flagged to the owner as a behavior change.
- **Boundary** `/tmp/boundary-b41b` runs with `/tmp/b41-drive.mjs` on both transports. The PR body `/tmp/b41-pr-body.md`
  passes `validate-pr-body.mjs` with no warnings, after trimming above-the-fold prose from 442 words to under 400.

## B.37 merged; B.41 boundary finds a stale coherence rule (2026-09-15)

- **#304** passed CI on `a1218d2f` (the merge with #307) and merged at `5163dff9`, gated on a fresh `gh pr checks`
  (10 rows, all pass) and `CLEAN`; B.37 is ✓. Its worktree is removed after the head-tree check.
- **B.41 boundary** `/tmp/boundary-b41b` on `4c3859d5`: `test:all` stopped at one unit failure.
  - `validation-self-tests.test.ts` › `validate:registry-coherence:self-test`, case "a clean tree reports no
    findings": `framework:delete — handleDelete() writes but does not register: none of [frameworkManager.unregister(,
unregister(] is reachable from it`.
  - The branch routes delete through `removeFramework()`, which unregisters inside `FrameworkManager`, and the rule's
    accepted calls do not name it. `validate:all` runs the same checker.
  - Round 4's targeted suites did not include `tests/unit/scripts`.
- **Round 5 to worker A:** update the rule to the call the branch uses, keep its mutation self-test load-bearing, run
  the validator-edit gates, and run the whole unit suite and `validate:all`. It waits for the boundary to end before
  editing.

## B.41 boundary on round 4: one stale checker; drive green (2026-09-15)

- **`/tmp/boundary-b41b` on `4c3859d5`:**
  - `test:all` exit 1, on the one unit failure already recorded (3308 passed);
  - `validate:all` exit 1, 1 of 60 steps: `validate:registry-coherence`, the same `framework:delete` rule;
  - every other step exits 0: `lint:ratchet` 3040/883, the tests ratchet 364, `build:prod`, `start:test`,
    `verify:package-artifact`, `validate:tool-schemas` identical, `verify:mcp` 18/18.
  - `validate:all` now has 60 steps: a step landed on `main` after 59 was last recorded.
- **Drive** `/tmp/b41-drive.mjs`, both transports at once. The branch passes every step on both:
  - switching to a created framework renders under it, with `tools/list` 3;
  - deleting the active framework selects CAGEERF (the configured default), and render and `tools/list` answer;
  - a framework seeded before a restart switches, renders, and falls back after its delete;
  - controls (`@cageerf`, switch to `react`) pass on every build.
- **The owner build** (the control, at `5163dff9`):
  - HTTP: every request after the switch errors, and run 2 cannot find the seed, because run 1's create failed on the
    broken server;
  - STDIO: render answers `Active framework 'b41a_fw' not found`, status still names the deleted framework after the
    delete, and the saved framework's render fails after a restart.
- **The PR body** `/tmp/b41-pr-body.md` gains the STDIO restart row and the fallback after run 2's delete, and passes
  validation.
- **The owner checkout** is rebuilt at `5163dff9`; `verify:mcp` 18/18. Round 5 (the coherence rule) is with worker A.

## B.41 round 5 accepted; final boundary running (2026-09-15)

- **Round 5** committed `7982e658` (2 files):
  - `validate-registry-coherence.js`: the `framework:delete` rule accepts `frameworkManager.removeFramework(` only. A
    bare `unregister(` would leave the selection naming a removed framework, the outage this branch fixes.
  - The self-test gains a delete mutation (`removeFramework` replaced by `Promise.resolve(true)`) that turns the gate
    red. Before it, only an `update` mutation touched the framework rule, so no mutation reached the delete rule.
  - Two processor comments that named `unregister` now say `removeFramework`. The checker scans comments, so a comment
    carrying the call text would keep the mutation green.
  - The worker reports `test:unit` 248/248 suites (3309 passed, 1 skipped) and `validate:all` 60/60.
  - Gate scope, noted rather than a finding: the checker's universe is `src/mcp/tools` only, so the hot-reload
    deletion path is outside it.
- **Probes on receipt:** the rule and self-test diff read as described; no session vocabulary; no baseline edits.
- **Final boundary** `/tmp/boundary-b41c` merges `main` `5163dff9` (#304) and runs the full suite and the drive.

## B.41 boundary green; PR #308 opened (2026-09-15)

- **Final boundary** `/tmp/boundary-b41c` on `74b3c161`, the branch merged with `main` `5163dff9` (#304; the CHANGELOG
  was rebuilt, 0 of main's lines removed):
  - every step exits 0: `lint:ratchet` 3040/883, the tests ratchet 364, `test:all` (unit 3309, integration 873, e2e
    252), `validate:all` 60/60, `build:prod`, `start:test`, `verify:package-artifact`, `validate:tool-schemas`
    identical, `verify:mcp` 18/18;
  - drive on both transports, branch: a created framework switches, renders, and keeps `tools/list` at 3; deleting
    it selects CAGEERF; a framework saved before a restart switches and renders, then falls back after its delete;
  - drive, owner build `5163dff9`: HTTP renders error after the switch; STDIO render fails and status keeps the
    deleted framework.
- **#308** was pushed and opened, with the title from the commit ("a framework created or kept in the workspace can be
  the active framework") and the body `/tmp/b41-pr-body.md`. The body validates, the title passes commitlint, and the
  suite counts are the boundary's. It is linked to the thread, and CI is being watched.
- **Behavior change flagged to the owner in the PR body:** startup refuses when the saved selection is missing and the
  default is unregistered.

## B.41 merged (2026-09-15)

- **#308** passed CI on `74b3c161` and merged at `15347639`, gated on a fresh `gh pr checks` (10 rows, all pass) and
  `CLEAN`; B.41 is ✓. Its worktree is removed after the head-tree check, and the owner checkout is rebuilt.
- **Five rounds:** measure, the shared-manager fix with the configured-default fallback, the refusal for deleting the
  default, one live source for the setting, and the registry-coherence rule that named the old call.
- **Still open from this row:** B.48 and B.49 carry hot removal. Neither is launched.

## The four gaps go out as measure-only work (2026-09-15)

- **Owner ruling on order:** the four gaps first; then hot removal (B.48, B.49) and the held bug rows (B.40, B.43–B.47)
  together; the tutorial walk (B.15) last.
- **Dispatched, all measure-only, all background:**
  - C on B.34 (schema and contract parity, dead `is_chain`) and D on B.39 (ratchet baseline slack), both read-only in
    the owner checkout at `15347639`;
  - E on B.35 (the `runtime/` import rule) in worktree `claude-prompts-mcp-arch`, and F on B.38 (conformance `HOME`
    and test state left in the tree) in worktree `claude-prompts-mcp-conformance`, both from `15347639`.
- **Each brief demands a positive control:** a comparison shown to catch a removed contract parameter, a probe shown to
  fail a forbidden import, a before/after file scan shown to catch a file the worker wrote, and a tally reconciled
  against the ratchet's own totals.
- **F carries a safety rule:** the defect is a test server writing into the developer's home, so every run takes a
  temp `HOME`, and any measurement that would need the real one is reasoned from code instead.
- Worktrees were created with `worktree:create`; both report `core.hooksPath=.husky/_` and symlinked `node_modules`, so
  no install runs.

## B.35 measured: the layer rule is absent, and two files cite it anyway (2026-09-15)

- **Worker E's verdict: REAL.** A probe import of `#runtime/paths.js` from each of the five layers passed with 0
  errors and 498 modules; the control (`modules/` → `#infra/config`) failed in the same session, so the harness fires.
  The worktree was left clean and the baseline (497 modules, 0 errors, 17 warnings) is unchanged.
- **Scope is small:** three `mcp/` value imports of runtime-state accessors, all reaching one class. No layer below
  `mcp/` imports `runtime/`, and nothing uses a relative path to dodge the subpath form.
- **A second shape, found in the same pass:** `runtime/resource-roots.ts` and `cli-shared/index.ts` each name a
  dependency-cruiser rule that does not exist, and `no-runtime-state-direct-access` matches a `runtime-state/` path
  absent from `src/`. Prose asserting a gate that was never written reads as coverage. A grep of rule-name citations
  in comments against the config's `name:` entries would catch all three mechanically; that goes into the fix scope
  for this row rather than a new row, since the comments must change with the config.
- **The row's own example was stale:** `mcp/tools/skills-sync.ts` does not import `#runtime/skills-sync-paths` at
  `15347639`. Recorded on the row.
- `origin/main` has moved again (another session), which the next boundary will take.

## B.39 measured: slack is concentrated, and regeneration has no gate (2026-09-15)

- **Worker D's verdict: REAL**, with the tallies reconciled against each ratchet's own output first (ESLint 3040/883,
  knip 1188 findings, tests-typecheck 364/67), so the per-rule tables rest on a probe shown to agree with the gate.
- **What the numbers say:** the ESLint ceiling carries about 160 spare errors, 106 of them in
  `strict-boolean-expressions`, while 11 rules sit at zero headroom. Knip carries 4. The tests-typecheck baseline
  carries none.
- **Bigger than the row:** `update-baseline` writes a fresh ceiling with no comparison, and nothing requires `check`
  to pass first. Regenerating at the wrong moment converts a live regression into the new floor. That belongs in this
  row's fix: regenerate only on a commit where `check` passed immediately before, and consider making
  `update-baseline` refuse when `check` fails.
- **Shelf life:** two of the three baselines were regenerated earlier the same day, and knip had already drifted by 4.
  A regenerated number lasts hours here, not days, so regeneration should land as its own PR and merge quickly.
- **Measurement drift, declared:** the owner checkout fast-forwarded from `15347639` to `05b61158` mid-run (an
  automated `git pull --ff-only` runs against it), so these numbers are `05b61158`'s. The worker recorded that rather
  than absorbing it.

## B.34 measured: all three claims real, and one name means two things (2026-09-15)

- **Worker C's verdict: REAL on every claim**, enumerated from the runtime `.shape` rather than a regex, with a
  positive control: a contract copied to `/tmp` with one parameter removed grew the schema-only list from 5 to 6, and
  the repository copy stayed untouched throughout.
- **Counts:** `resource_manager` 72 schema keys against 67 contract parameters, the five named and nothing else;
  `system_control` 33/33; `prompt_engine` 15/15; no required-versus-optional mismatch anywhere.
- **Second instance of the type shape:** `resource_manager.preview_action`, a `z.enum` against a contract `string`.
  The fix should take both, not just `system_control.action`.
- **Correctly ruled out:** `prompt_engine.gate_verdict` looks like a third, but its union is the documented dual
  shape.
- **`is_chain` is dead as a tool input**, and the token names a second, live thing: a column of the SQLite
  `resource_index` that the Python hooks read. A grep-and-delete would break working code; the removal must follow the
  data flow.
- **Worth keeping from the measurement itself:** the worker's first probe returned "unknown" for every field, because
  zod v4 dropped the internal field it read, and it exited 0 while doing so. It was caught by validating against a
  known case first. A uniform or empty result needs a control even inside the measuring tool.

## The ordered batch goes out: hot removal and the held rows (2026-09-15)

- **Owner's order:** the gaps first, then hot removal and the held bug rows together, then the tutorial walk.
- **Dispatched at `05b61158`, each in its own worktree, each measuring before fixing:**
  - **G** on B.48, B.49 and B.40 — one class: hot reload must watch every folder its loaders read and carry the
    framework id. The brief treats the saved one-line patch as a hypothesis, requires the coverage test to fail when
    the observer omits the id, and asks for an enumeration of every loader that composes more than one root.
  - **H** on B.43 and B.45 — replies that state something untrue: a suggested gate that does not resolve, and a
    skills-sync run whose counts are dropped. Includes an enumeration of every hard-coded gate id in guidance text.
  - **I** on B.46 and B.47 — failures that go unreported. The ruling is explicit, because both fixes can hide what
    they report: a build failure fails that request and names what failed, never a degraded tool surface; the save is
    awaited and a rejection reaches the caller.
- **K on B.44 is held** until a slot frees, keeping four workers live while F finishes measuring B.38.
- All four worktrees report `core.hooksPath=.husky/_`, symlinked `node_modules` and a clean tree.
- **Planner slip, caught by asserts twice:** the first insert matched `| F |` literally, but Prettier pads table cells;
  the second matched a padded first cell and hit two rows, since an earlier dispatch also used the letter F. The third
  selects on the row's first two cells. An empty commit was the only cost.

## B.38 measured: the home directory is inherited everywhere (2026-09-15)

- **Worker F's verdict: REAL on all three claims**, every run under a temp `HOME`, with a canary file proving the
  before/after scan detects writes before any "nothing was written" was recorded.
- **`HOME` is inherited at every spawn site.** `buildServerEnv` spreads `process.env` and scrubs only the MCP path
  variables; three e2e files set `HOME` themselves and the rest do not.
- **The risk is demonstrable, not theoretical:** a skills-sync export that passes validation wrote 6 files under
  `$HOME/.claude/skills/readme_improver/`, both by direct call and over a real `tools/call`. Today's conformance rows
  are safe only because validation refuses each combination first, which the corpus and its coverage validator both
  already say in writing.
- **State left in the tree:** `test:e2e` leaves a database and a log at the repo root plus `verify-state.db` under
  `server/`; `validate:all` leaves two cache files. `verify:claims` alone is clean — it already isolates
  `MCP_RUNTIME_ROOT`, and the sibling `mcp-server-smoke.test.ts` never got that fix. That is the one finding not
  already written down somewhere.
- **The shape worth carrying:** isolating `MCP_RUNTIME_ROOT` and isolating `HOME` are two separate conventions, so a
  caller can satisfy one and forget the other — and did. One helper that creates both is the proposed fix.
- **All four gaps are now measured REAL.** B.34, B.35, B.38 and B.39 each turned up more than their row claimed.
- **K is dispatched** on B.44 now that a slot freed.

## Owner ruling: all four gap fixes, after the current batch (2026-09-15)

- **Ruling:** fix B.34, B.35, B.38 and B.39, one worker each, once G, H, I and K finish. The order stands as the
  owner set it: this batch, then the gap fixes, then the tutorial walk.
- **What each fix carries, from its measurement:**
  - **B.34:** a parity check `resource_manager` does not have today, covering schema keys with no contract parameter
    and type disagreements (`system_control.action` and `resource_manager.preview_action`), plus removing the dead
    `is_chain` input along its data flow — never by name, since a live SQLite column shares it.
  - **B.35:** the missing direction rule, plus inverting the three `mcp/` value imports so `runtime/` hands the
    tracker down. The two files citing a rule that does not exist are corrected in the same change.
  - **B.38:** one helper creating a temp `HOME` and runtime root together, the smoke test's spawn sites redirected,
    `validate:hermetic-child-env` requiring `HOME`, and a gate that fails a run leaving state in the tree.
  - **B.39:** regenerate the ESLint and knip baselines on a commit where `check` passed immediately before, in its own
    PR that merges quickly, and consider making `update-baseline` refuse when `check` fails.
- **Worktrees for these are created at dispatch**, not now: `main` moves several times an hour here, and the two
  measurement worktrees already sit one commit behind.
- **Still with the owner:** whether to soften B.41's startup refusal, and the tutorial walk (B.15) last.

## The batch's four workers were interrupted and resumed (2026-09-15, late)

- The previous process exited while G, H, I and K were working. All four stopped with **no commits and no handoff
  files**, but their worktrees kept every edit: 8 files in `watch`, 6 in `replies`, 8 in `requests` (including a new
  untracked integration test), 4 in `docgates`. `origin/main` is unchanged at `05b61158`.
- **Resumed by message rather than relaunched**, so each keeps the context it had. Each was told, in order: commit what
  is complete now, reply with one line on where it got to, then finish its brief, committing as it goes.
- **The lesson to carry into briefs:** a worker that only commits at the end puts an hour of work behind a process
  that can exit. The brief should require a commit at the first complete unit, not at the finish.
- I re-stated the parts of each brief a resumed worker is most likely to drop: the before/after evidence per symptom,
  the enumerations, the removal of any temporary edit used to force a failure, and the handoff headings.

## B.44 first round accepted; the class goes back to its worker (2026-09-15)

- **Worker K committed `e0276e0f` and `3a1e8c0d`** (5 files): `readme_improver` and `documentation_change` declare
  `artifacts: produces: [docs, readme]`, and `code-quality` loses the `prompt_categories` list that is unreachable
  once `artifacts` is non-empty.
  - Measured on a real server before and after, with two controls: a prompt that already had its gates, and a general
    prompt that correctly has none. Both documentation prompts regained all four gates, plus `api-documentation`.
  - The new registry test was shown red with the fix stashed. `validate:all` 60/60, `test:unit` 3314 passed.
  - Probes on receipt: 5 files, no session vocabulary, no baseline edits, and the resource diff is exactly the three
    declarations.
- **Sent back to close the class:** `api-documentation` and `workflow-changelog` carry the same dead shape, and the row
  named only `code-quality`. The test must fail for **any** bundled gate declaring non-empty `artifacts` together with
  `prompt_categories`, enumerated rather than listed by name. Bound raised to 12 files.
- **New row B.50** from K's chain finding: a chain entry's own `gateConfiguration.include` never reaches its own run,
  because gate config resolves from each step's prompt. The chain got the new gates only because the execution planner
  re-derives the artifact-aware set separately — two derivations of one question.
- **Measure-first paid again:** a static read predicted the chain would not benefit; the live drive showed in two
  minutes that it did.

## B.43 and B.45 fixed; two more rows opened (2026-09-15)

- **Worker H committed `e26c0443`, `123cb4bd` and `9e230d64`** (8 files) on `fix/reply-honesty`, each defect measured
  live over MCP against a build of `main` and re-driven after, with a positive control per run and the filesystem
  checked both times.
  - A create reply no longer names a gate that does not exist; the registry-backed suggestions in the same reply are
    untouched and real.
  - A skills-sync response now opens with the run's counts, and a preview says plainly that no files were written.
    The filesystem agreed on both runs; only the new reply says so.
  - The new tests were run against the old source with `git stash push --keep-index`, so the before-failure is real:
    3 failed → 0.
- **Enumeration of every hard-coded gate id in guidance text** (against all 26 real gates) turned up two more shapes,
  now rows B.51 and B.52.
  - Six ids in `gate-analyzer.ts` all resolve today and stay hard-coded; the new registry-driven test covers them
    against future drift.
- **A claim to check, not assume:** the worker reports this repository's `commit-msg` hook strips the
  `Co-Authored-By: Claude` trailer by design, which is why its commits lack it. Verified separately rather than taken
  on trust.

## B.46's premise was false; what was real is fixed (2026-09-15)

- **Worker I committed `6d11c7ad` and `69ab1e8c`** (8 files, at the bound) on `fix/http-request-isolation`.
- **The row was wrong, and the measurement said so.** A one-shot throw at one request's surface build failed that
  request and no other; requests 2 and 3 returned the complete tool surface. The "every request until restart"
  symptom came from a persistent cause, fixed in #308 — the CHANGELOG already records it.
  - Calibration made the injection targetable: a control run showed one build at startup and one per request, so the
    throw could be aimed at request 1 rather than at startup, where the server already refuses to boot loudly.
- **What was real:** the failure reached nobody. `createMcpHandler` had no `onerror`, and the SDK's own never fires
  because the handler returns the 500 rather than throwing. Now a failed build names its stage in the server log,
  rethrown with its cause, and later requests still answer.
  - Evidence used the registration stage as an in-run control, because that stage does log for itself — so "nothing
    logged" is a measurement, not an absence.
- **The persist had two swallows, not one:** the state store caught its own save failure and printed the success line
  anyway, and the caller did not await. Both are gone, and the chain is awaited to the caller. A handler that did
  `catch {}` and then answered "Framework System Enabled" was fixed as part of it — invisible to every lint probe,
  because it awaits.
- **Ruling:** accept the reporting fix as this row's outcome, and keep the corrected premise on the row. A row whose
  claim measurement contradicts gets the correction written down, not a quiet redefinition.
- **Open limits, recorded rather than hidden:** the failing request's body is still the SDK's fixed internal error, so
  the cause reaches the operator's log and not the client; and a config-driven toggle that cannot persist now stops
  startup, which is this repository's precedent but still a behavior change for the owner to weigh.
- **New rows:** B.53 (the toggle writes the process default while its siblings take a scope) and B.54 (two paths log
  success before their detached work resolves).

## /tmp was wiped; the arc's tooling now lives outside it (2026-09-15)

- The restart cleared `/tmp`: `boundary2.sh`, both changelog helpers, and every drive script from this arc are gone.
  Only files written after the restart survived. The boundary run for `fix/reply-honesty` exited 127 with no summary,
  which is how it surfaced.
- **Nothing important was lost**, because each measurement's content was written into the plan rows and this ledger at
  the time. The four gap handoffs are gone as files and readable here in full.
- **Rebuilt in `/home/minipuft/.cache/tutorial-arc/`**, which survives a restart:
  - `boundary.sh` — same contract as before: merge `origin/main`, rebuild the CHANGELOG on a conflict, run the full
    suite, then the drive on the branch build and on the owner build as the before-control.
  - `changelog_rebuild.py` — rewritten. Each branch bullet keeps the heading it had on the branch, read from
    `git show HEAD:CHANGELOG.md`, and main's text is never edited. It reports inserted, already-present and removed
    counts.
  - `changelog_removed_check.py` — rewritten. Compares main, the merge base and the branch tip, so a line the branch
    itself deleted is allowed while a line lost to the rebuild is a finding, printed with the lost text.
  - Surviving drives are copied there too.
- **Carry this into briefs:** a measurement script or handoff written only to `/tmp` is one restart from gone. Durable
  conclusions belong in the plan and this ledger; durable tooling belongs outside `/tmp`.

## B.40, B.48 and B.49 fixed as one class (2026-09-15)

- **Worker G committed `cce779b8` and `0863f390`** (9 files) on `fix/hot-reload-watch-coverage`, each symptom measured
  on a build of `main` with a control in the same run, then re-measured after.
  - **Framework edits:** before, the edited guidance was never served in 20 s and 4 log lines said the event was
    skipped for a missing id, while the control prompt edit was served in 2.2 s — so the watcher was not blind, the
    event was. After: served in 1.1 s, no skipped lines.
  - **Removing a framework's folder:** before, the active framework stayed on the removed one; after, it falls back in
    about a second.
  - **Overlay prompts:** before, an overlay edit was never served and the overlay root was not watched; after, both
    hold. The chosen fix composes the loader's own root set through the helper the other three resource types already
    use, deleting prompts' private second derivation.
  - **A fourth fix, unbriefed:** the observer tags only `.yaml`, so a framework's `system-prompt.md` arrived untagged.
    The framework path now resolves its own id, as gate and style already do. That came from "close the class", not
    from the row.
- **The brief's cause for one symptom was wrong, and the measurement said so:** the folder _is_ watched and the
  removal _is_ reported — it was discarded downstream for lack of an id, so the first fix resolved it. None of the
  three remedies the brief offered applied.
- **A gate left behind:** the coverage test now scans `src/` for the watch-directory accessor and asserts the covered
  set, carrying its own positive control so it cannot pass vacuously.
- **Left open on purpose, now rows B.55, B.56 and B.57:** the arming window and unwatched overlays, the change
  tracker's narrower roots plus the unmeasured cost of 35 polled directories, and a dead framework reload callback.
- **Worth keeping from its feedback:** a drive can pass by incidental timing. Its first drive appeared to clear the
  removal symptom only because it waited 20 s, so a timing-dependent observation must state its timing. And the old
  coverage test described this very gap as intentional design — prose that read as rigour while nothing enumerated or
  expired it.

## B.43/B.45 boundary green; PR #310 opened (2026-09-15)

- **Boundary** `boundary-replies` on `9e230d64` (0 behind `main` `05b61158`): every step exits 0 — `lint:ratchet`
  3041/883, the tests ratchet 364, `test:all` (unit 3316, integration 889, e2e 252), `validate:all` 60/60,
  `verify:package-artifact`, `validate:tool-schemas` identical, `verify:mcp` 18/18.
- **Drive** (`b43-45-drive.mjs`, one JSON object, always exits 0) separates the builds:
  - owner build: `🧠 single • Suggested gates: basic_validation`, and a preview whose first lines carry no counts;
  - branch build: `🧠 single`, and `Files written (client: claude-code): 0 (preview — no files were written)`;
  - the client skills folder was absent after the preview on both builds, which is the point: only the branch says so.
- **#310** is pushed, opened and linked, with the body from `replies-pr-body.md`; CI is being watched.
- **The requests boundary** runs next, with no drive: its measurement needed an injected throw, so the integration
  test carries that evidence.
- **Noticed on push, outside this arc:** GitHub reports 13 Dependabot vulnerabilities on the default branch (11 high,
  2 moderate). Raised with the owner rather than actioned here.

## B.44's class was eight gates, not two (2026-09-15)

- **Worker K scanned all 26 bundled gates** rather than fixing the two named, and found seven carrying non-empty
  `artifacts` together with `prompt_categories` — eight including the one already fixed: `api-documentation`,
  `plan-quality`, `pr-performance`, `pr-security`, `security-awareness`, `test-coverage`, `workflow-changelog`.
  - The shape is dead by construction for every one of them: activation returns on the artifacts branch before
    `prompt_categories` is read. None differed, so all got the same removal.
  - Committed as `6aaeac46`, on top of round 1's `e0276e0f` and `3a1e8c0d`.
- **The closure condition is a test, not prose.** It loads every gate through the real registry and fails when any
  declares both fields, enumerated live rather than from a hand-kept list. Proved against the class: with the seven
  fixes stashed it failed naming exactly those seven.
- **A generated file came along:** `resources/gates/_index.md`, which the index validator reads and whose generator
  groups by `prompt_categories`; removing that field collapsed two now-empty sections. That is the 13th file, one over
  the bound, and the only way `validate:all` passes.
- **What this says about round 1:** its own `concerns` entry — "left untouched, flagging for a follow-up row" — was
  the shape `cleanup-standards.md` warns about: a documented blind spot that reads as diligence and closes nothing.
  Naming the class and demanding an enumeration turned two sites into eight.
- `validate:all` 60/60, `test:unit` 3316. Drive rebuilt at `~/.cache/tutorial-arc/b44-drive.mjs`, same
  `<serverRoot> <label>` interface as the arc's other drives; re-driven green on the branch.

## B.43 and B.45 merged as #310 (2026-09-15)

- **#310** passed CI and merged at `b6ac6083`, gated on a fresh `gh pr checks` (9 rows, all pass) and `CLEAN`. Both
  rows are ✓, and the worktree is removed after the head-tree check.
- **#311** (the request-isolation branch) is pushed, opened and linked; its boundary was green (unit 3313, integration
  891, e2e 252, `validate:all` 60/60). It goes `BEHIND` now that #310 landed, so it takes `main` again before merging.
- **The docgates boundary** is running with the rebuilt drive.
- **`pr-remerge.sh` is rebuilt** in `~/.cache/tutorial-arc/`: re-merge `origin/main` with the CHANGELOG rebuild, run
  build, typecheck and both ratchets plus one named test file, then push.

## 2026-09-16 — page re-check before the B.15 walk (worker R, check-only)

The tutorial branch took `main` `998c12b3` as `ced30024`, cleanly. Worker R drove every page step against a build of
that tree, under a temporary `HOME`/workspace/runtime root, and checked each statement by running it.

- **Holds:** the create write receipt, the default `general` category, bundled vs workspace roots and
  `edit_copies_on_write`, the rendered `## Task Context` block, preview-writes-nothing, update-saves-a-version, both
  on-disk layouts (the `prompt.yaml` and `user-message.md` shown on the page match byte for byte after #315 and #319),
  the verbatim JSON payload, and direct edits reloading in about 4.5 s.
- **False: lines 74–76.** "The `resource_manager` tool describes the same validate-then-create steps to Claude." Under
  the default framework, the description Claude receives comes from a stale framework override that lists 7 of 15
  actions. Opened as B.64. The planner confirmed it in this session's own tool list.
- **Resolved by the planner:** worker R could not tell whether Claude Code shows the model `structuredContent`, which
  the `inspect` fields live in. A read-only `inspect` from this Claude Code session returned the structured object,
  including `resource_root`, `source_root` and `edit_copies_on_write`, so the "Where your prompt is saved" step holds.
- **Left for the owner's walk:** `/plugin` install and reload, the `<plugin data>` directory name, and the `>>` hook
  firing, including closest-match replies for a mistyped id.

## 2026-09-16 — slice S1 of the remaining server rows (planner)

`>>strategicImplement` over B.50–B.63 and B.65–B.67 (17 open rows; B.64 merged as #323). Classified bug_fix.
Seventeen rows across about eight modules exceed one slice (at most 8 rows), and this repository cannot open a
subplanner through `--worktree`, so the rows run as sequential slices with at most 4 live workers.

- **Re-measured on `main` `9a7bfb1b` before cutting:** the anchors of B.51 (`PromptClassifier`, 6 references in
  its own file and 1 re-export), B.53, B.54, B.57, B.61 and B.62 (`pipeline-builder.ts:351`, and the `KNOWN_LEAKS`
  entry) are still present. The B.63 comment and the B.65 version reset use different wording on `main` than the
  rows quote; their workers locate them.
- **Rulings:** OQ-4 (the schema wins over contract text), OQ-5 (a ratchet below its ceiling fails), OQ-6 (delete
  `PromptClassifier`), OQ-7 (B.59 is measured before anything is changed).
- **S1:** W1 B.55–B.57 (opus), W2 B.58 + B.62 (opus), W3 B.60 + B.61 (sonnet), W4 B.67 (sonnet). Each runs through
  the `Agent` tool, which binds the model only; effort is this session's.
- **Collision watch:** W1 and W2 both sit near `runtime/`; `application.ts` is at 983 of 1000 counted lines, and
  both briefs hold it net-neutral. B.63 edits `validate-conformance-coverage.js`, which W3 may also touch, so B.63
  waits for W3.

### S1 · W4 (B.67) handoff received

- **Accepted in substance.** `check` now fails when a measured count is below its ceiling, identically in all three
  ratchets. It names the dropped keys and the command that fixes it. The mutations ran through the real CLI (an
  unused-var rename, a dropped `export`, a type annotation), and 14 unit tests were added. `validate:all` passed 64/64.
  Docs changed in `CLAUDE.md` (the two command-table cells), `CONTRIBUTING.md`, and `AGENTS.md` via `guidance:sync`;
  `AGENTS.md` stayed at 32767/32768 bytes.
- **Authored vs measured:** the row quoted ESLint 2936/802 and knip 1170, measured at `914b068c`. W4 measured 2922/799
  and 1165 at `9a7bfb1b`. The drop is PR #323's debt removal, not tool variance, as W4 had supposed.
- **DEV-S1-1 (planner, accepted):** W4 put the regeneration commit before the mechanism so it measured the untouched
  tree. It is still its own commit, which is what the brief needed.
- **Sent back:** PR #324 (`01cbb368`) landed mid-row and regenerated the baselines. Against it, the branch would raise
  `no-unnecessary-condition` (400 → 401) and knip `types` (667 → 668). W4 merges `main`, takes `main`'s baselines,
  checks, regenerates, and confirms every change is a decrease.
- **Finding, no row:** `.husky/commit-msg` strips the `Co-Authored-By: Claude` trailer by design, so worker commits
  never carry it. This matches the repository's recorded policy.
- **Consequence to watch:** once B.67 merges, any branch that removes debt fails `lint:ratchet` until it lowers its
  ceilings. That applies to W1–W3 and to other sessions' PRs, and is the intended cost of OQ-5.

### S1 · W2 (B.58, B.62) handoff received

- **Accepted, with three follow-ups sent back.** `b31339d3`: one `syncResourceIndex` helper serves startup and
  reload, and startup order is unchanged. `03d1931d` + `ebb290f7`: runtime state resolves from the runtime root.
  `SqliteEngine` requires a `dbPath`, and the `KNOWN_LEAKS` entry is gone. `validate:db-claim-order` now allows no
  `getInstance` without `dbPath` and no `'runtime-state'` segment outside `runtime/paths.ts`, shown by five planted
  mutations. A drive in both the `MCP_RUNTIME_ROOT` and plugin layouts put `verify-state.db` under the runtime root on
  the branch and under the package on `main`. `validate:all` passed 64/64; `test:all` passed unit 3666, integration
  970, e2e 273; `validate:python` passed 282.
- **Authored vs measured:** the row named four latent callers. Searching by shape found six, because two passed a
  `dbPath` that could be `undefined` and the old gate only looked for the token.
- **The hooks disagreed with the server before this row.** The Stop hook read `verify-state.db` from the install
  directory under the plugin, so the server fix alone would have split them. The hook now reads beside the `state.db`
  that `get_state_db_path()` finds. The function signatures are unchanged; `load_verify_active_state`, which
  gemini-prompts imports, is untouched.
- **Rulings:** keep `claimStateDatabase` and rule 1. Opened B.68 (a verify-loop store that swallows a failed write),
  B.69 (pytest has no tree guard) and B.70 (the CLI's state-db path ignores `MCP_RUNTIME_ROOT`).
- **Sent back:** read the `state.db` name from one place, with a gate; delete the dead
  `ChainSessionStoreOptions.serverRoot`; confirm the new info-level startup line stays off stderr under STDIO (#307).

### S1 · 2026-09-17 — usage limit mid-slice, workers resumed

The usage limit stopped W1, W2 and W3 at the same moment. I measured each worktree before resuming:

- **W1 (B.55–B.57):** no commits, 29 files uncommitted. It stopped while measuring B.56's polling cost by CPU time,
  which three concurrent workers made noisy. Resumed with instructions to read each hunk for leftover instrumentation,
  commit first, then measure deterministically (polled directories × interval, fs call counts, or event-loop delay).
- **W2 (B.58, B.62):** clean. Two of its three follow-ups are committed (`af1730ea` names the `state.db` path once;
  `1958cf8d` removes the unused `ChainSessionStoreOptions.serverRoot`). Resumed for the STDIO stderr check and the
  full row check.
- **W3 (B.60, B.61):** B.60 is committed (`66ceab4c`, `39ca09d6`). B.61 has 9 uncommitted files. Resumed with
  instructions to commit first, after checking none of those files holds a leftover typecheck mutation.
- **W4 (B.67):** finished. It merged `main` twice as `main` moved (`01cbb368`, #324; `8f9960eb`, #325). For the
  second merge it pinned the target SHA, because a re-fetch of `origin/main` during its first merge had produced a
  false increase. Final: ESLint 2923/800 → 2915/800 against `8f9960eb`, knip and tests-typecheck unchanged, with no
  increase anywhere. Taken to its PR boundary.

### S1 · W2 and W3 handoffs, and W4's PR

- **W2 (B.58, B.62) accepted.** Follow-ups: `af1730ea` (`state.db` is named once, through `getStateDatabasePath()` on
  the port; `validate:db-claim-order` rule 3 now fails on a hand-written `'state.db'` segment, shown by planting one at
  `mcp/tools/index.ts:235`) and `1958cf8d` (the unused `ChainSessionStoreOptions.serverRoot` is gone, with its 23 test
  writers and the check in `PromptExecutor` that only fed it). A STDIO start writes 0 bytes to stderr; a workspace
  config with an unknown key, used as the control, does write its warning there. Row check green on `1958cf8d`. Known
  gap, stated in the gate's own header: a template literal naming only `state.db` is not caught.
- **W3 (B.60, B.61) accepted in substance; one follow-up sent.** `15284246`: six contract element types now match
  their schemas (OQ-4), and the dated mismatch list is empty with a positive-control test. `38395b59`: `chain_step_*`
  scenarios for update and reorder. `4c06e176`: `routeToTool` is typed end to end, so a bogus action id fails
  `typecheck` (TS2820), shown by mutation. Sent back because `engine/` now imports the action-id type from `mcp/`, an
  upward edge that raises `validate:arch` warnings from 17 to 18. The vocabulary moves to `shared/`.
- **Opened:** B.71 (the `subject` scenario needs a runner change), B.72 (the contract-to-Zod adapter has no callers),
  B.73 (the `pass_criteria` example in the docs would be refused).
- **W4 → PR #326**, opened after a green boundary at `2f8bf3a2` on `main` `8f9960eb`: `validate:all` 67/67, unit
  3702, integration 980, e2e 276. The guard hook was bypassed under the arc-wide ruling, after `pr-check` passed 4/4
  inside the worktree.
- **Sequencing:** once #326 merges, a branch that removes debt fails `lint:ratchet` until it lowers its ceilings. W1–W3
  each merge the pinned `main` and regenerate before their boundary, as W4 did.

### S1 · W1 (B.55–B.57) handoff received

- **Accepted.** `e60478ad` (B.57): hot reload watches the prompts folder, not its parent. The parent watch had tagged
  the sibling type folders as prompt categories, so the real categories went untagged. `setFrameworkReloadCallback`
  is deleted, not wired; the auxiliary registration was the only path, and the unwired one only caused a second prompt
  reload per framework edit. `faf44d4f` (B.55): a folder whose watch arms late emits `LATE_DIRECTORY_ARMED` after its
  first scan, and every overlapping registration reconciles. Overlays count as roots before they exist.
  `9ab8a5fb` (B.56): the change tracker spans the primary folder and every overlay, not the bundled tree, and records
  one entry per served resource. `f0752827`: docs and three CHANGELOG bullets. `application.ts` is untouched.
- **Drive, with a positive control per case, every control observed:** a framework or gate created and removed at
  once stayed served past 15 s on `9a7bfb1b` and was released in 291–573 ms on the branch (4/4 runs). A new overlay
  folder's prompt, gate, framework and style were served in 36 ms to 1.6 s, against none at 15 s on `main`.
- **B.56 cost, measured without CPU time:** chokidar polled paths went 164 → 373 with #314, which is the bundled prompts
  tree (204) plus the overlay, and stay at 372 after this branch, each polled every 300 ms. Event-loop delay did not
  move (mean 10.1 ms, worst p99 15.5 ms). Authored vs measured: the row's "15 → 35 directories" depends on layout; W1
  measured 8 → 20 and 10 → 20.
- **Rulings:** B.56 semantics accepted (primary plus overlays; bundled excluded, so a package update does not log as a
  burst of edits). Opened B.74 (an event during a running reload is dropped) and B.77 (`FileObserver` emits events
  nothing listens to). Killed B.75 (the startup-to-first-scan window; closing it costs a full reload per start) and
  B.76 (a precedence flip across restart for an id present in both a legacy and a `resources/` folder), each with a
  revive condition.

### S1 · B.67 merged, and the three open branches take pinned main

- **#326 merged as `dd105eaf`** after CI 10/10 and a `CLEAN` state; B.67 flipped; worktree removed.
- **W3 accepted** after its follow-up: `a7559a19` moves `SYSTEM_CONTROL_ACTION_IDS` and `SystemControlActionId` to
  `shared/types/system-control.ts`, following `INJECTION_TYPES`. There is still one definition and no re-export shim.
  `validate:arch` warnings are back to 17.
- **Planner tooling, `~/.cache/tutorial-arc/remerge-regen.sh`:** merges a pinned SHA, resolves conflicts only in the
  three ratchet baselines (take `main`'s) and the CHANGELOG (rebuilt), and regenerates with no override. The B.39
  guard makes `update-baseline` refuse any increase, and a per-key diff against the pinned SHA confirms only
  decreases. Any other conflict aborts the merge untouched.
- **First run against `dd105eaf`:** W2 conflicts in `mcp/tools/index.ts` and W1 in
  `runtime/resource-change-tracking.ts` (both aborted cleanly and went back to their workers). W3 merged cleanly
  (`bce97a37`), and then the knip regeneration refused `types` 661 → 662: one exported type on W3's branch has no
  user outside its file. Before #326 that would have hidden inside the slack; now it goes back to W3.

### S1 · B.58 and B.62 merged; W1 and W3 take the next main

- **#327 merged as `a844497e`** (CI 10/10, `CLEAN`). The drive against a rebuilt `main` at `dd105eaf` put
  `verify-state.db` in the package in both layouts; the branch put it under the runtime root in both. W2's merge of
  `dd105eaf` had three conflicts, not the one my trial reported, because the script stopped at the first file outside
  the baselines. `remerge-regen.sh` now lists every conflicting file. W2 also fixed two tests `main` had just added,
  which still called `getInstance` without a path; they merged cleanly, so only a sweep of call sites found them.
- **A fourth ratchet:** `validate:unreached-methods` fails on a drop as well, and W1 lowered it (233 → 230) because
  its reconcile code now calls three methods. `remerge-regen.sh` regenerates and compares all four baselines.
- **W3 follow-up accepted:** the unused type was a `ToolRoutingResult` re-export left without a consumer (`6af80be3`).
  `test:all` then caught a consumer that the `.ts`-scoped symbol sweep had missed: `verify-mcp-surface.mjs` parses the
  action list from source text. It failed loudly, naming the move, and now reads the new file (`2edb5717`).
- **W1's drive on its boundary build (`e15befaa`) and on `main` `dd105eaf`, a control in every case on both:** `main`
  failed 6 of 7 cases at 15 s; the branch passed 7 of 7 in 30 ms to 1.6 s.
- **Pinned merge of `a844497e`:** W3 merged cleanly and regenerated with no increase (`e94cb337`). W1 conflicts in
  `module-initializer.ts`, where #327 moved the re-sync, and went back to W1.

### S1 closed; S2 · X1 (B.65) handoff received

- **#329 merged as `53cbcbda`**; B.55–B.57 flipped; worktree removed. X2 was dispatched from that `main`.
- **X1 accepted.** `52f88119` changes what `planFrameworkFiles` plans: create and repair write every file, with
  `version: 1.0.0` and `enabled: true` as create-only defaults; update and rollback write a file only when the merged
  result differs from what is stored. Measured on a hand-authored fixture (comments, odd key order, flow style, a judge
  file with no trailing newline). On `main`, a description-only edit reset `version` 3.1.4 → 1.0.0, rewrote an
  unnamed `phases.yaml` and stripped its comments, re-enabled a disabled framework, and took bundled CAGEERF from
  2.0.0 to 1.0.0. On the branch, only the changed file is written, and the phases-only and judge-only controls each
  write their own file. 26 tests, including a completeness check over every `[Framework]` contract parameter; three
  mutations turned 23, 16 and 2 tests red.
- **Planner correction:** OQ-8 told X1 to remove keys with `unset`, which I had not checked. Frameworks never receive
  `unset`, and a framework `unset` reports success and changes nothing. The ruling is amended in place and the silent
  success is now B.78. `cpm rollback` writing `tool_descriptions` under the payload spelling is B.79.
- **Pinned merge of `53cbcbda`:** clean, and the regeneration found nothing to raise (`c1bdeed4`).

## 2026-09-20 — B.59's mechanism was wrong; its symptom was worse than stated

Worker W-desc re-measured B.59 against a live `tools/list` from a hermetic server before touching
anything, and the row's stated cause did not survive it.

The row blamed `includeInDescription: false`, set on 63 of 72 contract parameters. That flag governs
only the tool's top-level prose block (`tool-descriptions.contracts.json`, built by
`generate-contracts.ts:185`). The JSON-schema-level `description` a client actually reads comes from
`.describe()` calls on the hand-written Zod schema, registered directly as `inputSchema` at
`src/mcp/tools/index.ts:1131` with no post-processing — and that file had **zero** of them.

So the measured state was 0/72, not the 9/72 the row implied, and the knob the row named would have
been the wrong one to turn. The fix wires the generated contract array into `.describe()`, matching
what `prompt-engine.schema.ts` and `system-control.schema.ts` already do. `resource-manager.schema.ts`
carried a header comment claiming it already did this; the comment was aspirational and is now true.

**Why this is worth recording.** This is the sixth row this arc whose premise moved under
measurement, and the first where the symptom was _understated_ rather than absent — which is the
harder case to catch, because a worker confirming "yes, descriptions are missing" could have stopped
there, edited `includeInDescription`, republished nothing, and produced a green row. The thing that
caught it was measuring the published surface rather than the file the row named. Ruling OQ-7's
"measure first" earned its keep here.

Two rows opened from the same handoff: **B.87** (nothing bounds the published `tools/list` payload —
this fix more than doubled one tool's schema and no gate noticed) and **B.88** (the three tools
disagree on whether parameter descriptions are framework-aware).

## 2026-09-20 — B.86 closes on better grounds than its own falsifier

The row's falsifier was "the test passes while a load generator saturates the machine." Worker
W-test could not make the OLD assertion fail: ~20 trials of CPU-spin at up to 8x oversubscription
(128 processes, some `taskset`-pinned to 2 cores), four concurrent `tsc --noEmit` plus two `eslint`,
and sustained process-creation churn at 40 forks/sec. `durationMs` stayed between 1004 and 1060 ms
in every trial against a 3000 ms ceiling.

So the row cannot flip on its stated condition, and the honest reading is that **the failure mode
was never reproduced on this hardware**. The planner's original measurement (4049–4237 ms, four jobs
sharing the box) stands as an observation, not as something re-derivable on demand. W-test's theory
is event-loop contention _inside one Jest worker_ during a full `--runInBand` suite, rather than
pressure from sibling processes — it deliberately did not test that, because generating it means
running large batches that contend with three live workers.

**The fix closes the class anyway, and that is why the row is done.** The old assertion was a
wall-clock CEILING (`elapsed < 3000`); the new one is a FLOOR (`durationMs >= 1000`). A floor cannot
be failed by a slow machine — Node's `setTimeout` is guaranteed not to fire early and promises
nothing about lateness — so the flake class is gone by construction whether or not the specific
4237 ms event reproduces. The question that matters is whether the replacement still catches what
the original was there for, and the mutation answers it: `}, timeout)` → `}, 0)` in
`shared/utils/process.ts` makes the new assertion red at 11 ms while `timedOut` and `exitCode: -1`
both stay green. It covers a class those two miss.

**Correction to the row's own text.** It said "a 2 s `shell_timeout`"; the code sets
`shell_timeout: 1000`. Same shape, immaterial to the fix, corrected in place because the row is a
written record.

**Re-check at the boundary.** The full suite runs once on a quiet machine at the PR boundary. If the
original flake is suite-internal contention, that run is where it would appear — and the new
assertion is immune to it by construction, so a failure there would mean something else.

## 2026-09-20 — DEV-S5-1: B.91's brief predicted the fix, and the prediction was wrong

I briefed W-catmap that fixing the hardcoded category allow-list meant calling the registry, named
three `CategoryManager` methods as "the intended call sites", asked another session to hold them
from deletion, and told the worker that **waking one was the expected outcome**. The worker woke
zero, and was right to.

Running the fork first showed the registry is populated at execution time but neither reachable from
`CategoryExtractor` (built with `(semanticAnalyzer, logger)` only) nor **needed**:
`PromptLoader.loadFromDirectories` already stamps `prompt.category = categoryId` at `loader.ts:215`,
from the same directory scan that feeds `CategoryManager.loadCategories`. The category on the prompt
_is_ the registry entry's id. Threading a registry provider through `ExecutionPlanner` and
`PromptExecutor` would have added a second derivation of an answer already in hand — B.91's own
defect shape, wearing the fix's clothes. Verified independently at `loader.ts:215` before accepting.

**What this cost:** a restore commit in another session's tree (`e645949b`) for three methods that
did not need saving. What it bought is better: one of them, `validatePromptCategories`, turns out to
be **dead by construction** rather than merely uncalled — it reports "prompt references a
non-existent category" while the loader forces the category from the directory it just registered,
so the condition can never be false. That is a stronger deletion case than "no callers", because it
survives "but shouldn't something validate categories?".

**The reusable part — a HELD artifact rots exactly like a stale `✓`.** `cleanup-standards.md`
§A Status Outlives What It Described says a marker needs an as-of date and a falsifier in both
polarities. A _hold_ is a third polarity nobody stamps: mine was true when written, unchecked
afterwards, and nothing attached would ever expire it. Asking for the falsifier with the hold
("released when X measures false") makes it self-retiring. Cheaper still, and what the worker
actually did: state in the handoff's first line which held symbols the row called. Zero, arriving
early, is what frees them.

**Second lesson, on brief-writing.** A brief that names the fix removes the worker's reason to run
the fork. The row's Verification and bounds are mine to set; the mechanism is the worker's to
measure. Naming three call sites as "intended" was me doing the row's thinking badly from outside
the tree — and only the brief's own §Before you fix it section stopped it landing.

Also surfaced: **`CLAUDE.md`'s Domain Ownership Matrix has no row for which service owns category
validity**, which is part of why a second derivation could live in `engine/execution/planning/`
unchallenged for as long as it did. Not this arc's file to edit; recorded for whoever owns that
matrix.

## 2026-09-20 — the fork check, scored: three rows, three forks away from the wording

W-stores took B.95, B.96 and B.97. **None was "live and wrong"; all three were deletions.** The rows
had been written as scoping fixes, which is exactly the correction the owner made earlier that day.

- **B.95 — superseded.** `GateStateStore.isGateSystemEnabled(scope)` already answers the question.
  Wiring `GateManager` instead would have added an _unscoped_ read — the shape
  `resolveContinuityScopeId`'s own docblock records as the 2026-08-27 cross-workspace defect. The
  deleted override fell through to `BaseResourceHandler.isSystemEnabled()` → `true`, the value the
  never-written field already forced: zero behaviour change.
- **B.96 — redundant, not mis-scoped.** Every write to a persisted field is followed by an awaited
  `saveStateToFile(scope)` in the same method. There is no state only shutdown would save, so
  widening the persist to every scope would have been the wrong repair of a dead call.
- **B.97 — unconsumed.** Deleted with the 30 s timer, the `healthCheckInterval` field, and
  `GateSystemState.isHealthy`, whose only reader was that timer.

### Authored vs measured — two planner counts were wrong

| I wrote                               | Measured                                                                                      | Where it came from                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `health-changed` has **9** emit sites | **7**, plus 2 event-map declarations                                                          | I counted the type declarations as emit sites |
| B.95 has **2** stale doc citations    | **4** (`mcp/tools/index.ts` :453 AND :462, `prompt-engine.schema.ts:249`, `core/index.ts:96`) | I stopped at the first hit per file           |

Both errors ran the same direction: I counted from a quick grep and reported it as an enumeration.
The second is the worse one — "fix the 2 citations" would have left 2, which is the fix-1-of-4 shape
this arc has a rule against. Worth noting that **three of those four comments justified the claim by
naming `GateService.getGuidanceText` and `validateContent` — a class and two methods that do not
exist in `src/`.** Stale prose accumulated faster than the code it described.

### A gate that prose can satisfy (row B.102)

`validate:unreached-methods` resolves JSDoc `{@link X}` as a reference through
`findReferencesAsNodes()`, so writing `{@link deadMethod}` in any docblock retires that method from
the gate. Measured directly by the worker. This is worse than a normal false negative because the
natural thing to write when documenting a dormant method IS a link to it — the gate is most likely
to be defeated by someone doing the right thing.

### Rejected finding — W-whoami's CI gap does not exist

W-whoami reported that `verify:mcp:self-test` is registered but never run by CI, so a new
`system_control` action could ship with no `TOOL_CHECKS` coverage. **Checked and false.**
`server/tests/unit/scripts/validation-self-tests.test.ts` runs every `*:self-test` script in BOTH
manifests, derived as `Object.keys(manifest.scripts).filter(name => name.endsWith(':self-test'))`
with no exclusion list — so it is covered, and its own docblock says a new self-test "is covered the
moment it exists and cannot be forgotten". The worker saw `verify:mcp` in `ci.yml` and `verify:mcp:self-test`
absent from the workflow, which is true and not the whole path. No row opened. Recorded because a
rejected finding that leaves no trace gets re-found.

Ironically `ci.yml:318-321` already carries this exact lesson in a comment — "CI proved the verifier
worked and never verified the surface. A self-test proves the check runs; it does not run the check."
That comment is about the opposite direction, which is probably what made it misread.

### Ruled: no CHANGELOG bullet for any of the three

The worker asked to be overruled on B.97 if a disappearing log line counts as consumer-observable.
It does not: the warn fired 30 s after a deliberate disable, on the default scope only, with an
**empty issue list** (`status: 'disabled'` pushes no issue). Removing a spurious warning nobody could
act on is not a consumer-visible change. B.95 deletes an always-true read; B.96's removed writes were
already on disk or were unchanged defaults written into a bucket nothing reads.

## Close-out (2026-10-05)

The plan and its branches were left on `docs/tutorial-first-run` on 2026-09-20 when the planning thread ended; about 110 pull requests landed on `main` before this close-out. Four read-only investigators re-measured every open row and every unmerged branch against `main` at `8d2c77e7a`:

- Branch `fix/pipeline-scoped-state-reads`: mostly superseded by #359 and #368 (header fix, scope through stages 07/12/20, `selectFramework` scope, scoped gate provider, switch history). Still live: the shell-verify gate switch at `pipeline-builder.ts:324` reads the launch workspace; switch counters are store-wide (`framework-state-store.ts:744`, killed as B.81); no validator for unscoped reads. 17 conflicting source files, so re-applied as C.6.
- Branch `fix/resource-manager-parameter-metadata`: both commits live (`resource-manager.schema.ts` has no `.describe`; `enabled_only` untagged). 4 conflicts after #367 and #379 reshaped the schema; re-applied as C.5.
- Branch `fix/documented-identity-command`: the docs no longer promise `whoami` (#368, #441 point at `status`); `status` reports no identity; the owner dropped the action. The doc-action check is C.7.
- Branch `fix/gate-guidance-category-registry`: all three commits live (`category-extractor.ts:74,182,205`; selection at `gate-enhancement-service.ts:289` and rendering at `:345` read different categories). 3 conflicts; merged as C.2.
- Branch `fix/state-store-consumer-audit`: all three commits live (`gate-manager.ts:64,128,291`; unscoped saves at `gate-state-store.ts:535`, `framework-state-store.ts:942`; 7 `health-changed` emitters, 0 subscribers). 2 conflicts; merged as C.3.
- Branch `test/conformance-subject-scenario`: both commits live. 1 conflict; merged as C.4.
- Branch `docs/tutorial-first-run`: the page is still needed (`docs/tutorials/` unchanged on `main` since 2026-08-23); its `mcp-tools.md` and `create_prompt` edits are covered on `main`; `--page` is contained in it. Landed as C.1.
- Rows: 6 done on `main` (B.50 #445; B.80, B.92, B.104 #368; B.94 #368 and #441; B.101 #437), 2 obsolete (B.83, B.99), 10 killed, 12 carried into Tier C, B.15 the owner's.

## Close-out deviations (2026-10-06)

- DEV-C-1 (C.4): the brief's mutation (exception re-added, scenario deleted) went red on `activation`, not as a satisfied exception; three mutations separated the two reds.
- DEV-C-2 (C.3): a "`rg` prints nothing" probe cannot hold while the guard test names the event; the emitter-set test is the closure. B.95's stale claim sat at three sites.
- DEV-C-3 (C.10): three commit subjects reworded for commitlint; `--strict` dropped from the documented-options allowlist with its only use; `%guided` went in `d39fdb744` (2025-12-08) with no changelog entry. `CLAUDE.md` item 1 still names `server/prompts/**`, a directory that does not exist (owner's handbook).
- DEV-C-4 (C.2): 11 files against 8; two semantic conflicts fixed in the merge (#344's registry throw, #342's satisfied exception). CI then exposed the pre-existing retry-budget defect for the three categories the old list accepted; fixed in `gate-set-resolver.ts`. The worker's first handoff left the two e2e files that pin a retry budget to CI; files that pin through `activation.prompt_categories` must run with any row that changes category resolution.
- DEV-C-5 (C.6): 12 files against 7: the executor is built once per pipeline, so the scope travels through three call paths. The validator keeps its framework-only name. `gate-state-store.ts:508` calls `getSystemHealth()` unscoped inside the store.
- DEV-C-6 (C.5): the brief's three `.describe` calls were zero; the size check lives in `validate:tool-schemas` (after the build), not `validate:all`; the 2026-09-20 sizes were stale (15,341 → 33,620 bytes today). No shared contract-to-zod lookup exists; `prompt_engine` hard-codes its text.
- DEV-C-7 (C.7): ground truth is the contracts' enums; the 2026-09-20 script was rewritten (its `[^)]*` broke on nested parens). `operation:` values and prose `action:` tokens outside a tool head are not claims.
- DEV-C-8 (C.8): 5 files against 4 (lint baseline). HTTP now emits a tools-changed notification after a `system_control` framework switch, enable or disable. Two `refreshToolSurface` copies could become one; `handleToolDescriptionChange` still logs "restart" advice.
- DEV-C-9 (C.11): 13 files against 6 (four sites under `teardown.push(`); the harness never knew the server pid, so the guard reads the spawned environment; a throw mid-teardown leaked servers until the guard was made to kill first. CI then caught two more files (`mcp-server-smoke`, `bundled-resource-fallback`) the worker had read but not run.
- DEV-C-10 (release): #232 merged 2026-10-06 as 5.0.0 on the owner's word; npm publish failed (root workspace not installed before `test:ci`), fixed in #457; 5.0.1 (#458) is the first 5.x that publishes. Release-please moved Unreleased into 5.0.0; a planner script that rebuilt branch changelogs from `main` duplicated #451's bullet via #456, repaired by #455. Branch protection's up-to-date rule cost one CI cycle per merge.
- DEV-C-11 (C.12): the vocabulary has 22 entries, not 9: four bundled styles list 13 tags that are not directories, and the brief had not counted them. Finding: a style's `activation.prompt_categories` has no reader under `src/` (only `style-schema.ts` declares it), a field with no consumer, a candidate row of its own.

## B.15 walk (2026-10-06)

A Sonnet agent with no other context read `docs/tutorials/build-first-prompt.md` on `main` and followed sections 2 to 5 with real calls; the owner then typed the section 3 line in the client. Everything the page says the server does, it did: validate wrote nothing; create wrote version 1 with the three files named; the run rendered the Task Context text verbatim; preview wrote nothing; update saved version 2; the `>>` hook turned the owner's line into the call and the 20-word template rendered. Findings a newcomer would hit:

1. The page names the plugin data directory as the write root; the receipt names the real root (`~/.claude/resources/prompts` here, because the shell exports a resources override). The page could say the receipt is the source of the path.
2. The rendered reply carries a framework block with required sections and a `chain_id` continue token; the page mentions framework guidance in one sentence and never says how Claude answers.
3. Section 2 says Claude asks the reader to confirm; the server's own text says existing authorization suffices.
4. Section 4 does not mention `expected_version`, which the agent passed on its own.
5. Section 5's create JSON shows the pre-update template; the files section shows the 20-word one.
