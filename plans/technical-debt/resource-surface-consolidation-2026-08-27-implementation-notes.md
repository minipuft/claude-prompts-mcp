---
title: "resource_manager surface consolidation — implementation notes"
date: 2026-08-27
status: active
tags: []
---

# Implementation notes — resource_manager surface consolidation

Deviation log for `resource-surface-consolidation-2026-08-27.md`. Created at plan start, before the
first source edit, per the deviation-log rule.

## Session log

### 2026-08-27 — plan created by splitting its predecessor

No source edits. `resource-manager-settability-matrix-2026-08-13.md` had become five documents under
one `status:` — an audit, two decision sets, a design, and an execution record — so "is it done" had
no answer while Arc 1 was complete and 29 rows were open. The audit is finished; the work it
uncovered is not.

The predecessor retires to `reference` with every row terminal: `✓`, `⚠` where a premise was
falsified, or `✗ SUPERSEDED` naming the successor row. Fourteen table rows were mapped individually;
the prose-form items (gaps 2/3/4, row 5b/5c, SF-1…SF-4, gate severity, framework passthrough,
category type, `create_prompt` bridge) are mapped wholesale in its header block.

`✗ SUPERSEDED` is used deliberately rather than "migrated". `cleanup-standards.md` §Do or Kill
rejects relocation as a state because it keeps work alive nowhere — the objection is limbo, not
movement. A row pointing at a numbered row in a live `active` plan is not limbo; a row pointing at a
backlog nothing pulls from would be.

## Rulings

### P1.0 — the personal overlay needs no new environment variable (2026-08-28)

The row asked whether relocating runtime state and logs alongside resources is acceptable, "since
`MCP_WORKSPACE` drives all three". It does not, and has not since `MCP_RUNTIME_ROOT` shipped
(`server/src/runtime/paths.ts:130`, covered by `tests/unit/runtime/paths.runtime.test.ts:17`).

| Dial                 | Controls                                           | Independent of `MCP_WORKSPACE` |
| -------------------- | -------------------------------------------------- | ------------------------------ |
| `MCP_RESOURCES_PATH` | resources base                                     | yes                            |
| `MCP_RUNTIME_ROOT`   | `runtime-state/` (`state.db`) and relative `logs/` | yes                            |
| `MCP_WORKSPACE`      | the default for both, **and** overlay detection    | —                              |

**Ruling**: point `MCP_WORKSPACE` at the personal library and set `MCP_RUNTIME_ROOT` to keep
`state.db` and logs where they are. Named side effects: `MCP_WORKSPACE` also moves `config.json`
resolution (a workspace `config.json` is preferred when it exists) and the derived project scope id
falls back to `CLAUDE_PROJECT_DIR` → cwd basename, not to the workspace — so scope is unaffected.

It has to be `MCP_WORKSPACE` and not `MCP_RESOURCES_PATH`: `getOverlayResourceDirs` returns `[]`
unless `isUsingCustomWorkspace()`, which compares the workspace to the package root
(`paths.ts:360`). Setting only `MCP_RESOURCES_PATH` moves the primary root and leaves overlays off.

`MCP_RUNTIME_ROOT` was documented in `paths.ts` and nowhere a user reads — absent from the
`ENVIRONMENT VARIABLES` help in `src/index.ts` and from CLAUDE.md §Environment (paths), whose
"`MCP_WORKSPACE` (primary — SSOT for all paths)" was inaccurate. Both fixed in the same change.

## Deviations

### DEV-P1-1 — the ruling uncovered a fatal defect, and P1 grew a row

Answering P1.0 meant reading how a workspace actually resolves, which surfaced that
`resolveResourceSubdir` returns the FIRST existing candidate and stops. A workspace resource
directory therefore REPLACED the bundled tree instead of overlaying it — the opposite of the plan's
own standing constraint and of the contract in `src/index.ts`'s help.

Measured against a real STDIO server, three different failures from one cause:

| Type       | Workspace held         | Before                                             | After           |
| ---------- | ---------------------- | -------------------------------------------------- | --------------- |
| frameworks | one framework (`5w1h`) | **exit 1**, `FATAL: Framework 'cageerf' not found` | boots, serves 8 |
| prompts    | one prompt             | serves 1                                           | serves 40       |
| styles     | an empty directory     | serves 0                                           | serves 4        |

Taken as P1.0a rather than deferred: it is a startup crash, and P1.2/P1.3 are unreachable without
it — "the source is the bundle" cannot arise under a workspace that suppresses the bundle, so both
rows would have compiled, passed review, and never executed.

### DEV-P1-2 — gates were the fourth site, not an exception

`createGateManager` was never given a gates directory, so `GateDefinitionLoader` fell back to
`resolveGatesDir()`, which walks up to the PACKAGE `resources/gates` and consults neither
`MCP_RESOURCES_PATH` nor the workspace. Gate READS therefore ignored both while gate WRITES have
resolved through `getGatesPath()` since Arc 1 — a read/write divergence Arc 1 recorded as closed.

It also made the startup inventory lie: measured 2026-08-28, `gates: 25 — <workspace>/resources/gates`
for a directory containing one gate. That line is mine, from `92cafa83`. Fixing three types and
leaving gates would have been a fix at the sites found rather than of the class.

Arc 1's e2e could not have caught it: `resource-write-destination.e2e.test.ts` copies the ENTIRE
bundled tree into the workspace, so primary and bundle contain the same definitions and replacement
is indistinguishable from overlay. The new e2e uses a workspace holding exactly one entry per type.

### DEV-P1-3 — two of P1's own inventory claims did not survive re-measurement

- "83 of 123 prompts are gitignored" → **84** (`123 - 39`, main checkout). Corrected in place.
- P1.6's falsifier compared tracked count to on-disk count. Inside a worktree both are 39, because
  a worktree checks out only tracked files — the falsifier passes without the work being done. It
  is the same shape as the `| tail -40` exit-code loss from Arc 1: a check that cannot observe its
  own subject. Re-anchored to the absolute count (123) in the main checkout.

### DEV-P1-4 — writebacks done by row-id regex, not exact-line match

Two of the four row rewrites in this session failed an exact-line `str.replace` because the padding
differed from what was read. That is DEV-T1-8 recurring: pre-commit Prettier reflows table column
widths, so any writeback keyed to a full line is one commit away from silently no-opping. Every row
edit here matches on `^\|\s*P1\.N\s*\|` and asserts the match before substituting.

### DEV-P1-5 — the ratchet passed while complexity rose; measured against HEAD instead

`lint:ratchet` reported "OK: 3093 errors, 974 warnings (no regressions)" for a change that took
`initializeModules` from cognitive complexity **66 to 76** and `loadPromptData` from **22 to 23**.
Both functions were already over the limit of 15, so the violation COUNT was unchanged and the
ratchet — which counts violations, not their size — had nothing to report. The baseline is a
ceiling, not a measurement.

Caught by measuring HEAD's version of each file against the working copy through the same linter,
rather than by reading the ratchet's verdict. Extracting `resolveResourceRoots`,
`resourceInventoryOf`, `loaderDirsConfig` and `loadWithBundledBase` brought `initializeModules` to
**55** — 11 below where it started — and left `loadPromptData` at **23**, one above. Both remain
over the limit; that is pre-existing debt these two orchestration functions carry, not something
this change introduced.

The extraction also retired three `isVerbose`-only "Additional <type> directories:" log lines. The
inventory's `↳` lines carry the same information unconditionally, so keeping both would have meant
two reporters for one fact, one of them unreachable under STDIO.

### DEV-P1-6 — the e2e suite pollutes the package tree, and it has cost a commit before

`npm run test:e2e` left 7 `examples/conformance_*` prompt directories under
`server/resources/prompts`. `examples/` is a tracked category, so they appear as untracked files,
and the served prompt count read 47 instead of 40 until they were removed. This is the same trap
that swept 14 conformance fixtures into a commit in Arc 1 (reverted at `d881dad2`). Filed as P5.5;
removed by hand here.
