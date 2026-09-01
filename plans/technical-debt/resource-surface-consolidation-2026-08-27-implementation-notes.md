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

### DEV-P1-7 — I corrected P1.6's falsifier in the wrong direction, then corrected it again

The 2026-08-28 re-anchor replaced "tracked equals on-disk" with "the main checkout reports 123
tracked". That reads the migration as moving the 84 personal prompts INTO git. The predecessor's D5
says the opposite: `resources/prompts/` becomes **bundled-only** and fully tracked, with the
personal prompts moving to a store outside the repo. Under D5 the end state is 39 on disk and 39
tracked — not 123.

The original falsifier was therefore closer to right than my replacement, and its only real defect
was vacuity in a worktree. The corrected check names both halves so neither a worktree nor a
mis-read direction can satisfy it by accident: nothing ignored remains under
`server/resources/prompts` in the main checkout, AND the personal store answers from a root outside
every checkout.

Worth keeping as the shape of the mistake: re-anchoring a falsifier means re-deriving the END STATE
it is supposed to detect, not just replacing a number that could not be trusted. I substituted a
measurable quantity for an unmeasurable one and skipped asking which direction the work runs.

### Backup receipt (2026-08-29)

`backups/claude-prompts-mcp/resources-full-2026-08-29-001204.tar.gz`, 254K, taken from the MAIN
checkout — a worktree carries only the 39 tracked prompts. Verified against the live tree:
123 `prompt.yaml`, 27 gates, 8 frameworks, 4 styles. `state.db` deliberately excluded: it is
WAL-mode SQLite and a plain `cp`/`tar` can capture a torn page, and it is regenerable.

The prior backup (`resources-prompts-2026-08-19-235626.tar.gz`) was **not** adequate for P1.6 — ten
days stale at 121 prompts, and prompts only, with zero gates, frameworks or styles.

## P1.5 — staging receipt (2026-08-29)

Owner ruling: the personal store lives at `~/.claude/resources`, reached by `MCP_RESOURCES_PATH`
alone. `MCP_WORKSPACE` stays at the plugin root, so `config.json`, `state.db` and logs do not move.
This is SIMPLER than the P1.0 ruling recorded above, and P1.0a is why: that ruling said a personal
store "must set `MCP_WORKSPACE`", which is true only of the OVERLAY mechanism
(`getOverlayResourceDirs`, gated on `isUsingCustomWorkspace`). The bundled-base merge added by
P1.0a is unconditional, so pointing the resources base outside the repo now suffices — the personal
store becomes the primary (so writes land in it) and the shipped catalog merges underneath.
Verified live: `MCP_RESOURCES_PATH=/tmp/personal-store` with one prompt served 40, naming both roots.

**Staged, not switched.** 230 files / 84 prompts copied to `~/.claude/resources/prompts`,
byte-compared against source (0 missing, 0 differing), and confirmed to contain no bundled prompt.
`.mcp.json` is UNCHANGED and the originals under `server/resources/prompts` are UNTOUCHED, per the
owner's instruction to stop before either.

`.ignore` was excluded from the copy. It is a ripgrep/fd visibility override that exists only
because the sibling `.gitignore` excludes `*`; it is tooling, not a prompt, and P1.6 should delete
it in the same change that deletes the `.gitignore`, or it becomes a file whose stated rationale no
longer exists.

**Verification, with a positive control.** A real STDIO server against the new store served
**119 prompts**. That is four short of the 123 files on disk, which looks like loss — so the same
server was run against today's live single-directory layout as a control. It also served **119**.
The store is faithful; 119 is simply the correct served count, and the 123-vs-119 gap is
pre-existing. Without the control this would have read as four prompts destroyed by the move.

The only difference between the two runs is a category: 16 against the control's 17. The extra one
is `prompts/tools/`, an empty untracked directory containing no files at all, which registers as a
category and contributes nothing. Nothing to copy, nothing lost.

Reconciling 123 to 119 took three causes, not one — recorded on P5.2, and the duplicate-id half
split out as P5.6 because it is an identity problem rather than a counting one:

| Cause                            | Count              | Effect                                             |
| -------------------------------- | ------------------ | -------------------------------------------------- |
| Invalid YAML                     | 3                  | prompt never loads                                 |
| Ids duplicated across categories | 5 ids              | later load silently wins; the first is unreachable |
| Dropped inline gate definitions  | 8 across 6 prompts | prompt loads, enforcement silently absent          |

### DEV-P1-8 — the flip was staged against the wrong binary, caught one step before the restart

I recommended flipping `.mcp.json` and restarting. That was wrong, and the check that caught it was
running the server with EXACTLY the environment `.mcp.json` produces, against the binary it names —
`${CLAUDE_PLUGIN_ROOT}/server/dist/index.js`, which is MAIN's build.

Main is at `ca39e300` and does not carry P1.0a. Measured: with the resources path pointed at the
personal store, main's dist served **81 prompts from `~/.claude/resources/prompts` alone**, with the
39 bundled ones silently gone and no inventory line to say so. A restart would have cut the catalog
from 119 to 81.

Every earlier probe in this session ran the SETTABILITY worktree's dist, which has the fix. Those
probes were correct about the code and said nothing about what the client would actually launch.
The config names one binary and I had been verifying another.

Ordering constraint, now on the P1.5 row: the fix reaches main and main is rebuilt BEFORE the
`.mcp.json` flip, not after.

Second blocker, raised by the owner and confirmed: `.mcp.json` is tracked and ships with the repo,
so a literal `/home/minipuft/.claude/resources` would reach everyone who clones it. The flip needs a
user-scoped override or `${VAR:-default}` expansion. Whether Claude Code supports the latter in
`.mcp.json` is UNVERIFIED — no instance of that syntax exists in this repo's JSON to copy from.

The edit was made, then reverted. The first revert used `cp` from a backup and landed in a different
worktree than the edit, leaving main still carrying the personal path while the output read as
restored. Corrected with `git -C <main> checkout -- .mcp.json` and confirmed across all four
worktrees. Lesson: in a multi-worktree repo, revert with `git -C <explicit path>`, never a bare
`cp` that depends on ambient cwd.

## Tier P1.5-X — execution record (2026-08-29)

Landed: main fast-forwarded and rebuilt; the redundant resources path removed from the canonical
`mcp.json`; `MCP_RESOURCES_PATH` set machine-locally in `~/.claude/settings.json` and in
`~/.config/claude-prompts-catalog.env`; the catalog verified serving the personal library.

`validate:all` 48/48, real exit 0. Not pushed.

### DEV-P15-1 — `.mcp.json` is generated, and I edited the artifact

`.mcp.json` is a RENDERED projection of canonical `mcp.json` (`scripts/render-targets.json`
declares `canonicalTree.mcp`). My first edit went to the projection. `validate:render-drift` caught
it by byte-comparing against the source and named the exact line.

Two things worth keeping. The gate did its job — this is what a drift check is for, and it fired on
the first run after the edit. And the tier's own text pointed at `.mcp.json` throughout, because
that is the file the launcher reads; nothing in the row said it was generated. A row naming a file
should name whether that file is authored or produced.

`MCP_RUNTIME_ROOT` is present in `mcp.json` but dropped from the rendered `.mcp.json` — which is why
the live plugin servers carry no such variable while the systemd unit sets its own. Not a defect;
the renderer targets a client with no `${PLUGIN_DATA}` equivalent.

### DEV-P15-2 — P1.5c was answerable immediately; the row said it was not

The row asserted that no hand-run probe could establish whether `~/.claude/settings.json` `env`
reaches an MCP subprocess, and that only a restart would tell. That was wrong. The block already
held `ANTHROPIC_DEFAULT_HAIKU_MODEL`, so tracing that ONE value settled the mechanism:

    claude process  (pid 819107, 803061)  → ABSENT
    MCP subprocess  (pid 819203, 803158)  → ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-sonnet-5

Claude Code injects the block into MCP subprocess environments rather than into its own. The
generalisable part: when a question is "does mechanism X reach Y", look for a value already
travelling that path before declaring the question unanswerable. An existing setting is a free probe.

### DEV-P15-3 — two of the tier's own assertions failed re-measurement

- Branch was **16** commits ahead, not the 15 the tier asserted.
- P1.5f's falsifier ("no tracked file contains the personal path") was **unsatisfiable**: 14 tracked
  files already contain it, all `plans/**` reference prose quoting measured sessions. That is
  legitimate and permanent, so the row could never have passed. Rescoped to config and source files,
  where the count is 0 and the property is real.

The pattern: a falsifier written as a repo-wide absolute is almost always too broad, because
documentation legitimately quotes the thing being forbidden. Scope it to the surface that can
actually violate it.

### DEV-P15-4 — a stray file from an earlier misdirected `cp`

`server/.mcp.json` was sitting untracked in main — created when the previous turn's revert `cp` ran
with the shell's cwd inside `server/`. Deleted. It also explains the `??` status that turn, which I
misread as the file being untracked rather than as a NEW file in a different directory.

Reinforces DEV-P1-8's lesson: in a multi-worktree repo, file operations that depend on ambient cwd
are how edits land in the wrong tree. Use `git -C <path>` or absolute paths.

### DEV-P15-5 — the systemd unit had the same redundancy as `.mcp.json`

The unit set `Environment=MCP_RESOURCES_PATH=` on line 9 and read `EnvironmentFile=` on line 10, so
the override would have won only because of line order. Removed the hardcoded line so the env file
owns the value outright. Same shape as P1.5b, found by asking the same question of a second consumer.

### Counts

Main's bundled tree still holds the 84 originals (P1.6 has not run), so the merged catalog reads
**120**, not the 119 the settability worktree produced with its 39-prompt bundle. It becomes 119
once P1.6 removes them. Both exceed the 119 today's live configuration serves, so the cutover loses
nothing.

### DEV-P15-6 — "1:1 files" is not "1:1 served", and the owner asked the right question

Asked to confirm the transfer was 1:1 before deleting anything, the file-level answer was already
proven: 230 files, byte-identical, nothing missing. That answer was true and insufficient.

Comparing the served ID SETS — current tree versus the post-deletion shape — showed
`examples/deep_analysis/initial_scan` present in one and absent in the other. Root cause:
`mergePromptResults` keyed `convertedPrompts` on `name`, a display label with no uniqueness
constraint, while keying `promptsData` on `id`. Two prompts labelled "Initial Scan" collided, and
the overlay evicted the bundled one.

The asymmetry is what made it invisible: `promptsData` kept both, so the startup count read 120 and
looked healthy, while the served surface had 119 entries and the tool could not resolve the missing
one. A count-based check would have shown 120 → 119 across the deletion and been explained away as
the expected duplicate collapsing. Only the set difference named the prompt.

**Generalisable**: when a migration is verified by counting, the check cannot distinguish "one lost"
from "one duplicate resolved". Compare identities, not cardinality.

Two measurement errors on the way, both self-inflicted:

- `comm` was run against lists sorted under the ambient locale, which is not `comm`'s collation. It
  reported three losses and printed "input is not in sorted order" — a warning easy to skim past
  while reading the result as data. Re-run under `LC_ALL=C`.
- The "post-deletion" configuration was measured using the settability worktree as a stand-in for a
  tracked-only bundle, which it is. But that worktree is a SEPARATE CHECKOUT and never received the
  fix, so the second measurement graded fixed code against an unfixed binary and still showed
  losses. Same class as DEV-P1-8: the config named one binary and I was verifying another.

### P1.6 readiness (2026-08-29)

With P1.5g in, deleting the originals is a no-op for the served surface:

    A  current tree (bundle incl. 84 originals + personal store)   120 ids
    B  post-deletion shape (tracked bundle + personal store)        120 ids
    lost 0 · gained 0

Backup `resources-full-2026-08-29-001204.tar.gz` verified at 123/27/8/4, and all 230 personal files
confirmed byte-identical between the originals and the store immediately before this check.

### P1.6 executed (2026-08-29)

231 files removed from `server/resources/prompts` (84 prompts, plus category metadata, message
files and script tools), together with `.gitignore` and `.ignore`. Each file was confirmed present
and byte-identical in `~/.claude/resources/prompts` immediately before deletion — 0 missing, 0
differing — and the delete set was re-derived from `git ls-files` at execution time rather than read
from the earlier temp file.

Result: 39 on disk, 39 tracked, no ignore files, `git status --ignored` clean under that path. The
served ID set is byte-identical to the pre-deletion baseline: 120 both sides, zero lost, zero
gained.

**The commit contains one removed file.** The other 231 were untracked, so git had nothing to
record — which is exactly the condition P1.6 existed to end, and worth stating plainly because a
one-file diff for a 231-file change reads as a mistake otherwise.

The `analysis` category directory disappeared from the bundled tree entirely: every prompt in it was
personal. The served catalog is unaffected because the personal store supplies that category, and
the set comparison confirms it rather than assuming it.

---

## P1 Arc 2 executed — P1.1, P1.2, P1.3 (2026-08-30)

### Owner rulings taken before compiling the tier

| #   | Question                                                            | Ruling                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | What happens when you edit a resource resident in the bundled tree? | **Copy-on-write, said out loud.** The receipt names the source, the destination, and that the copy is now detached from bundled updates. Rejected: refuse-and-require-explicit-fork (two calls for every first edit) |
| R2  | Delete your own copy that shadows a bundled resource                | **Deletes your copy; the bundled one is served again, and the response says so.** Rejected: refuse-when-anything-underneath (leaves no way to undo a fork), and delete-from-every-library (blast radius)             |
| R3  | Scope                                                               | **Fix the whole class across prompt / gate / framework**, not the literal rows                                                                                                                                       |
| R4  | The path traversal found while measuring                            | **Fix it first, inside this arc**                                                                                                                                                                                    |

### Re-measurement: two of the three rows had false premises

**P1.2 was understated, not wrong.** The row reads as though "update writes to the source root"
were work to be added. Measured first: an update ALREADY resolves the highest-precedence writable
root and already copies the top-level files up. What it did not do was carry the on-disk SUBTREE,
and the loss was silent and large:

| Case                                               | Before                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `planning/implementation_plan`, `description` only | 5 chain steps replaced by 42–55 byte scaffold stubs; `discovery/user-message.md` 3852B → 50B; the served step then returned the stub |
| `examples/create_framework`, `description` only    | all 4 files under `tools/framework_builder/` absent at the destination                                                               |
| `frameworks/cageerf`                               | refused outright: `Failed to load framework files … may be corrupted`                                                                |

Root cause is narrower than "copy-on-write is missing": the preservation logic was already correct
and was being handed an EMPTY directory. `createOrUpdateYamlPrompt` honours `suppliedKeys` only
for an existing prompt, and `scaffoldChainStepDirectories` skips step directories that already
exist — so copying the subtree first turns the fresh-directory case back into the ordinary one.
The fix is a copy, not new preservation logic. Whole-subtree rather than a list of known file
kinds, because a list preserves only what someone remembered to enumerate and both losses above
were exactly the kinds nobody had.

**P1.3's falsifier already passed — a stale `☐`.** "Deleting a bundled prompt under a distinct
workspace refuses and removes no file" was TRUE before any work: the search covers the writable
root only, so the prompt is not found and nothing is touched. The row would have been marked ✓ by
anyone who ran its own check. The real defect was that all three refusals stated a reason that was
false:

    prompt    -> "Prompt not found: quick_decision"                  (the same server had just inspected it)
    gate      -> "Gate directory not found: <workspace path>"        (named a path never meant to exist)
    framework -> "Framework directory not found: <package path>"     (and resolved the WRONG ROOT — see below)

This is the `cleanup-standards.md` asymmetry in the wild: the `☐` disclaimed work that was done,
and the reason nobody caught it is that the falsifier tested the refusal and not its content.

### Findings that were not rows

**F-A — path traversal (fixed first, per R4, commit `233b2bf2`).** A caller-supplied segment could
steer a resource write outside the resources root. Measured against `dist/`, each with a passing
benign control: prompt `category:'../../ESCAPED'`, gate `id:'../../ESCAPED_GATE'`, framework
`id:'../../ESCAPED_FW'` all wrote outside the root and reported success. Only the prompt `id` was
guarded, by a validator reached from the draft service and never from `category`;
`validateCategoryName` existed with **zero call sites**. A validator named for the job made the
surface read as covered.

Fixing the three types was not fixing the class. Enumerating every file that resolves a resources
root and writes found a fourth — the HTTP `create_category` handler, joining a request body field
into `mkdir`. Widening that enumeration to include roots rolled by hand from `getServerRoot()`
found two more: framework `delete` and `skills-sync`. Six sites, three of which no per-type pass
would have reached. `validate:contained-resource-writes` now runs the enumeration every build.

**F-B — framework `delete` resolved a different root than framework `write`.** It built
`join(getServerRoot(), 'resources', 'frameworks', id)`, hardcoding the package tree — the exact
defect D8 Arc 1 fixed for framework creates (`9e229e1e`) and missed here. With a personal library
configured, deleting a framework you had just created there looked in the package tree and
reported it missing. Found by the widened enumeration, not by looking.

**F-C — P5.4 is verified, and its answer is "yes, but".** Reproduced while probing: a create
returns `isError: true` under a `✅ **Prompt Created**` headline. The full untruncated body DOES
carry `❌ **Post-write verification failed**` — at line 14, under the success headline. So
`isError` is correct and the ORDERING is the defect. P5.4 may now be executed; its "verify before
fixing" condition is met.

**F-D — a create with a spaced category always reports failure.** Same capture: `category: 'My
Category'` slugs to `my-category` on disk, and post-write verification compares against the
authored value, so it reports `mismatched: category` for a write that succeeded. Filed as a row
(P5.9), not fixed here.

### Deviations

| id       | What                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-P1-1 | `validate:all` cannot reach 50/50: `validate:plan-row-tracking` fails on 19 unstamped rows in `plans/features/mid-chain-unknown-surfacing-2026-08-20.md`. Pre-existing at HEAD, confirmed by stashing. NOT fixed here — that plan was committed 15 minutes earlier by a concurrent session working in this same checkout, and stamping its rows under an active session is the shared-HEAD hazard `CLAUDE.md` describes. Recorded rather than fixed |
| DEV-P1-2 | `ConfigManager` gained `getBundledResourceDirectory`, which broke six partial test stubs at RUNTIME while typechecking cleanly — they use `as unknown as ConfigManager`. Caught by the suites, not by `typecheck:tests:ratchet`, which is the mock-integrity hole `testing.md` names                                                                                                                                                                |
| DEV-P1-3 | The new e2e suite failed at SUITE level with `ENOTEMPTY` while every test passed: `kill()` only signals, and teardown raced the server's log flush. Now awaits exit. A teardown failure that reads as a product failure is worth the four extra lines                                                                                                                                                                                               |
| DEV-P1-4 | P5.5 recurred twice more this session — `npm run test:e2e` leaves 7 `examples/conformance_*` dirs in the package tree. The second time it broke `validate:readme`, which counted 46 prompts against the README's 39. P5.5 is now a gate-breaking bug, not only litter                                                                                                                                                                               |

### Closing receipt — P1 Arc 2 (2026-08-30)

Two commits: `233b2bf2` (containment, landed first per ruling R4) and `b6e66d6f` (P1.1–P1.3).

| Check                     | Result                                                               |
| ------------------------- | -------------------------------------------------------------------- |
| `validate:all`            | 49/50 — the one failure is DEV-P1-1, another workstream's plan       |
| unit                      | 2746 passed, 1 skipped                                               |
| integration               | 745 passed                                                           |
| e2e                       | 182 passed, 2 skipped (8 suites)                                     |
| `verify:mcp`              | 18/18, including `no resource mutation — server/resources untouched` |
| `lint:ratchet`            | 3092 errors / 969 warnings, no regressions                           |
| `typecheck:tests:ratchet` | 367, no regressions                                                  |

**DEV-P1-1 is now evidenced, not just argued.** While this arc ran, the concurrent session
committed `3fce6c75` (04:07), then `cbcf1734` (04:28) — the latter landing BETWEEN this arc's two
commits (04:25 and 05:20). Its plan is under active edit by another actor in this same checkout,
which is the concrete reason its 19 unstamped rows were left alone rather than a cautious guess.
The reasoning generalises: in a shared checkout, "ownerless housekeeping" (`dev-workflow.md` Gate
Skip Policy) stops applying to a file another live session is mid-arc on — the rule assumes the
owning session has ENDED, and here it demonstrably had not.

**Follow-ups this arc created, all as rows rather than prose:** P5.9 (spaced category always
reports failure) is new; P5.4's verify-before-fixing precondition is now MET and it is ready to
execute; P5.5 escalated from litter to gate-breaking, having failed `validate:readme` by inflating
the served prompt count from 39 to 46.

---

## Tier P5 — corrections and hygiene (2026-08-30)

### Owner rulings

| #   | Question                                                                                                                | Ruling                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3  | P5.1's defects left the repo with P1.6 — is it still work?                                                              | **Both**: repair the library AND add a repo-side gate so a silent drop becomes detectable                                                                                                      |
| R4  | The 3 invalid prompts cannot be reached by `resource_manager` — its registry has no id for a prompt that failed to load | **Direct YAML edit, and file the tooling gap.** A resource whose defect prevents it loading is unreachable by the only tool allowed to author it — a genuine hole in the MCP-Tooling-Only rule |

### Re-measurement before execution — three of four rows had false premises

| Row  | Authored                                                           | Measured 2026-08-30                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P5.1 | 3 invalid + **5** dropped gates; "two sit in untracked categories" | 3 invalid + **8** dropped gates across 6 prompts. 10 of 11 are no longer repo files at all (P1.5/P1.6 moved them to `~/.claude/resources`) — but the 11th, `knowledge-capture/practice_capture`, is **tracked**, and its two gates had never loaded |
| P5.4 | precondition MET, ready to execute                                 | Confirmed exactly; the only row whose premise survived                                                                                                                                                                                              |
| P5.5 | "the suite cleans up unconditionally, **including on failure**"    | The suite leaks on a **passing** run (105/105 green, 7 directories). Cleanup was never the defect — isolation was                                                                                                                                   |
| P5.9 | comparison is against the wrong side                               | Confirmed, and the cause is `loader.ts:186` overwriting `category` from the directory                                                                                                                                                               |

### Deviations

**DEV-P5-1 — P5.5's prescription would have hidden its own defect.** The row asked for
unconditional cleanup. Implementing that literally would have deleted the evidence and left the
suite still writing to the packaged tree, still believing it was isolated. Root cause:
`startServerWithHttp` defaulted `MCP_RESOURCES_PATH` to the package tree, and that **outranks**
`MCP_WORKSPACE` in `PathResolver.getResourcesPath()` (priority 1 vs 2), so a caller asking for
isolation with `MCP_WORKSPACE` alone was silently overruled by the helper's own default. The
scenarios stayed green because the workspace OVERLAY resolves separately — the single fixture they
assert on was found while every mutation landed in the wrong tree. **A default that outranks the
caller's stated intent is not a default.**

**DEV-P5-2 — the guard is a diff, not an emptiness check.** Asserting `server/resources` is clean
would fail on any pre-existing untracked file a developer legitimately has, so it would be turned
off within a week. `package-resources-guard` snapshots the tree at `globalSetup` and fails at
`globalTeardown` on what THIS run added. It watches the path rather than the suites, so a leak from
a suite nobody has written yet is caught by the same check.

**DEV-P5-3 — a positive control that failed for the wrong reason, twice.** First attempt planted a
stray file BEFORE the run, so the diff correctly ignored it and reported exit 0 — the guard working
as designed, read as the guard not working. Second attempt used `__dirname` in an ESM test and
exited 1 from a `ReferenceError`, which looks identical to the guard firing. Only the third
(`import.meta.url`, file written during the run) produced the actual property: **1 test passed,
exit 1**. Recorded because both wrong answers were plausible, and one of them was a false green.

**DEV-P5-4 — the headline was extracted, not patched in place.** Appending the failure ahead of the
success line would have left two claims in one response. Choosing which claim a response leads with
is a decision and is testable without the orchestrator's context (`architecture.md` private-method
diagnostic), so it moved to `utils/mutation-headline.ts` with 7 unit cases covering both branches.

**DEV-P5-5 — `validate:prompts` reports more than the runtime log does, and that is correct.** After
the kebab-case repair, `general/test_gate_chain` still carried three `Unrecognized key` errors the
startup log never printed: Zod surfaces a subset, and the log prints one line. The gate reports the
full set, which is why P5.10 could be scoped precisely instead of iteratively.

**DEV-P5-6 — DEV-P1-1's hold point expired, so the housekeeping was done.** The 19 unstamped rows in
`plans/features/mid-chain-unknown-surfacing-2026-08-20.md` were left alone last arc because a
concurrent session was mid-arc in this checkout. Re-measured: no commits for 10 hours, file clean,
and this plan's own note said the next session should stamp them if that one did not. Each stamp is
its row's OWN `Verify` column restated — the falsifiers already existed, they just were not in the
status cell, which is what makes this housekeeping rather than authorship. `validate:all` reached
**51/51** for the first time this initiative.

### Verification ledger

| Check                     | Result                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `validate:all`            | **51/51** — all green, including the new `validate:prompts`                        |
| unit                      | 2754 passed, 1 skipped (217 suites)                                                |
| integration               | 745 passed (58 suites)                                                             |
| e2e                       | 182 passed, 2 skipped (8 suites); package tree gained 0 files                      |
| `verify:mcp`              | 18/18                                                                              |
| `lint:ratchet`            | 3092 errors / 965 warnings, no regressions                                         |
| `typecheck:tests:ratchet` | 367, no regressions                                                                |
| P5.9 mutation             | remove category normalization → the e2e case fails; restored green                 |
| P5.5 mutation             | restore the unconditional helper defaults → 14 files leak, guard exits 1           |
| P5.11 self-test           | accepts a valid prompt, catches an empty description AND a gate missing `guidance` |

### Left open, deliberately

**P5.10** — the three invalid prompts in the personal library. Each authors chain steps in a
vocabulary `ChainStepSchema` rejects, and `general/resume_variant_build` is a content-free stub
duplicating a real id. Inventing step semantics in the owner's content is authoring, and deleting
the stub is destructive; both need a ruling, so the row stays open rather than being closed by a
guess. `validate:prompts --root ~/.claude/resources/prompts` is its falsifier and reports the exact
error set.

**The tooling gap R4 names is not yet a row anywhere.** `resource_manager` cannot repair a resource
whose defect prevents it loading — the registry has no id to address. It belongs to the settability
surface (P2/P4), not to P5, and is recorded here so it is not lost between them.

## Issue #229 — hot reload under a non-default resources root (2026-08-30)

Recorded here because the defect and its fix both live on the resources-root surface this plan
owns. Investigated in a separate worktree (`fix/hot-reload-resources-root`); no source change from
that branch is proposed for this plan — see the closing note.

### What was measured

Issue #229 was filed as "prompt hot reload does not fire under STDIO; same edit is picked up over
HTTP". Transport turned out not to be the variable. One variable held apart from the other, against
`78262981`:

| Transport       | Resources root                  | Reload observed |
| --------------- | ------------------------------- | --------------- |
| STDIO           | bundled (`server/resources`)    | yes, t+5s       |
| STDIO           | external (`MCP_RESOURCES_PATH`) | no, held 200s   |
| Streamable HTTP | bundled                         | yes, t+5s       |
| Streamable HTTP | external                        | no, held 120s   |

The negatives are negatives, not refusals: every failing arm returned `prompts/get` OK reading
stale content, and the bundled arm is the positive control proving the probe observes a reload when
one occurs.

### Root cause — already closed by P-arc work on this plan

Startup resolved the prompts root through `PathResolver`; `reloadPromptData` re-derived it through
`ConfigManager.getResolvedPromptsDirectory()`, which resolved `config.json`'s relative
`prompts.directory` against the config file and therefore always answered with the bundled tree.
Two derivations of one question, and the file watcher held the wrong one.

Nothing failed loudly. The reload succeeded, rebound the bundled catalog, and `setLivePrompts`
published content that no longer contained the edited prompt — so `resolveLivePrompt` fell back to
each prompt's registration-time snapshot and served stale text with no error.

`233b2bf2` (contain resource writes to the resources root) fixes exactly this, at the shared
method, for all seven of its callers. Verified against a build of local `main` with no other
change applied: an external-root edit is observed at t+5s. **No further work is needed for the
reported defect.**

This is the same read/write divergence `233b2bf2`'s own message names — worth noting that it also
silently governed the reload path, which was not part of that row's stated scope.

### Still open — an overlaid prompt never reloads

☐ **R-HR1** (as of 2026-08-30 · flips when an edit to a bundled-only prompt under an external
`MCP_RESOURCES_PATH` is observed by `prompts/get` within one debounce window)

With an external root configured the bundled tree is still served underneath as an overlay
(`prompts/list` = 113: 80 external + 33 bundled). An edit to a prompt existing _only_ in the
bundled tree is never picked up:

```
bundled-only target: triage
before_ok = true                                      <- prompts/get succeeds; not a refusal
edit to a BUNDLED prompt under an external root: observed = false (60s)
```

Positive control: same build, same run, an external-tree edit observed at t+5s.

Cause: `reloadPromptData` loads the base directory only, while startup merges base + overlays
(`runtime/data-loader.ts`, `getOverlayResourceDirs` + `mergePromptResults`). The live map is
rebuilt from the base tree alone and overlaid prompts fall back to their registration-time
definition.

**Why a count-based check cannot see it.** `prompts/list` reports 113 before _and_ after the
reload — binding is deduped per shell, so the entries survive while their content stops tracking
the file. Any gate for this asserts on served content, not on catalog size.

**Shape of the fix.** One base+overlay load owned by the prompts module and called by both
`runtime/data-loader` and `prompt-refresh-service`, with `mergePromptResults` moved there rather
than duplicated — the same consolidation this plan applies elsewhere. An implementation exists on
`fix/hot-reload-resources-root` (local branch, unpushed) together with five falsified regression
tests; it was written against `origin/main` and predates `233b2bf2`, so roughly 70% of it is
superseded and only the overlay half is worth carrying forward.

### Deviations

**DEV-HR-1 — the issue's own evidence was structurally blind, and re-measurement was the only way
to see it.** #229's `prompts/get` column read `-32602 "Prompt reasoning not found"` before _and_
after the edit: `guidance/reasoning` is not in the served catalog, so that witness could never have
read true. A refusal was recorded as a negative. The STDIO result also does not reproduce on the
commit the issue was filed against. Both the original title and its evidence table were corrected
in place, with the original preserved.

**DEV-HR-2 — the first probe run was invalid because it inherited the operator's environment.**
`MCP_RESOURCES_PATH` was set in the invoking shell, so the server served the personal library while
the probe edited the worktree tree. The run was discarded and every later arm set the resources
root explicitly. The contamination is also what pointed at the real variable, and is the most
likely explanation for the original report's HTTP arm disagreeing with its STDIO arm.

### Follow-up corrections (same day, owner-flagged)

**DEV-P5-7 — the P1.7/P1.8 commit mapping was crossed, in both directions.** Owner flagged that
`233b2bf2` "fixed more than its row claimed". Re-measured with `git show --stat`: that commit
carries P1.7 **and** the first half of P1.8 (the validator, its suite registration, and the HTTP
`create_category` site), while P1.8's last two findings — framework `delete` and `skills-sync` —
landed in `b6e66d6f`, a commit whose subject is copy-on-write. P1.8 named no commit at all. No work
was missing; the ledger simply could not lead a reader from either row to the code. The reusable
shape: **an enumeration gate and the per-site fixes it finds tend to land in one commit**, so a row
owning the gate and a row owning the sites compete for it and one goes unattributed — unless the
receipt is written from `git show --stat` rather than from memory.

**DEV-P5-8 — P5.10 needed a measurement before it needed a decision.** It was filed as "owner
decisions, not repairs" on the strength of the errors alone. Once the owner ruled "align to modern
standards", the first move was measuring what modern IS: all 5 bundled chains put one sub-prompt per
step in its own nested directory and carry **no** inline step content. That made two of the three
mechanical after all — the blocker was never the semantics, it was not having read the convention.
`dependsOn` was dropped rather than translated, because on a strictly linear chain the sequence
already is the dependency.

### Tier P5.12–P5.15 — the id convention (2026-08-31)

**Owner rulings**: codify the convention as MEASURED (not change it) · full sweep + rename for the
two camelCase ids, **deferred to this plan** · normalizer + gate + Zod tightening · and a question
back: should there be an auto-fix?

**DEV-P5-9 — the answer to the auto-fix question was "not yet", and the evidence said so.** The
line for auto-repair is that the correct output must be fully DETERMINED by the input. Sorted
against the eleven defects this arc actually measured, that set is **empty**: eight dropped gates
needed a `guidance` string written, three invalid prompts needed steps re-authored, the stub needs
a deletion decision, and the convention violations need renames — which a fixer must refuse by
construction, since a rename is safe only if every reference moves with it. Killed as P5.14 with a
revive condition rather than built, because a feature with no cases is a parallel system with a
nicer name.

**DEV-P5-10 — the divergence was not latent, and the resolution was the opposite of what it looked
like.** `normalizePromptId` and the parser's inline copy differ by one `.replace(/[^a-z0-9_]/g,
'')`, and they DO disagree in practice — on nested chain-step ids, which ship
(`deep_analysis/initial_scan` → `deep_analysisinitial_scan`). The instinct was to adopt the
stronger version. Reading the call site inverted that: the capture group feeding it is
`([a-zA-Z][a-zA-Z0-9_-]*)`, which already excludes every character the strip removes, so the strip
**cannot delete anything**. It was a second guard standing where the first already held, and its
only effect was to make two copies of one rule disagree on inputs neither could receive. Dropping
it was the fix; adopting it would have broken qualified-id matching in the draft service.

**DEV-P5-11 — the new gate's first act was to catch a mistake in the change that shipped it.**
Converting the two personal chains (P5.10) I named the nested step directories in kebab
(`jd-analysis`). `validate:prompts` immediately flagged nine of them. It was right: a step
directory is a **prompt-id segment**, addressed as `>>deep_analysis/initial_scan`, so it is snake —
the bundled tree proves it (`initial_scan`, `deep_dive`, `plan_table`). The kebab id belongs to the
`chainSteps[].id` **node** id, a different namespace inside the same step. Both were renamed to
snake and re-verified on a live load. The two spellings sitting one line apart in the same YAML
block is the sharpest form of this confusion, and it is now the doc's worked example.

**DEV-P5-12 — two gates caught the change through the state it was in, not its content.**
`validate:documented-options` failed on a documented `--root` flag that WAS implemented: the
validator scans **tracked** files and the new script was untracked. `knip-ratchet` then failed on
`+2 exports` — `PROMPT_ID_PATTERN`/`KEBAB_ID_PATTERN`, exported but only used by their own
predicates. Both were correct: the first is the committed-state-vs-worktree-green class, closed by
staging; the second improved the design, since handing out the raw regex invites the direct testing
that produced the duplication in the first place. Third gate, `typecheck:tests:ratchet`, caught the
test still importing `normalizePromptId` from its old home — the Test Surface Audit case, found by
sweeping `tests/` for both moved symbols rather than fixing only the file that errored.

### Verification ledger (P5.12–P5.15)

| Check                         | Result                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `validate:all`                | **51/51**                                                                     |
| unit                          | 2766 passed, 1 skipped (218 suites)                                           |
| integration                   | 745 passed (58 suites)                                                        |
| e2e                           | 182 passed, 2 skipped; package tree gained 0 files                            |
| `verify:mcp`                  | 18/18                                                                         |
| `lint:ratchet`                | 3092 / 965, no regressions                                                    |
| `typecheck:tests:ratchet`     | 367, no regressions                                                           |
| `validate:prompts` (bundled)  | OK, 39 prompts, 2 deferred exemptions                                         |
| `validate:prompts` (personal) | 1 schema error + 4 convention violations — all owner content, all now visible |
| live load                     | all 9 renamed nested steps resolve under snake ids                            |
