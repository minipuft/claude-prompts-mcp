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
