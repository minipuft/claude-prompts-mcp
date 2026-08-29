---
title: "resource_manager surface consolidation — where resources live and what is authorable"
date: 2026-08-27
status: active
tags: []
---

# resource_manager Surface Consolidation

Successor to `resource-manager-settability-matrix-2026-08-13.md`, which retires to `reference` with
every row terminal. That file remains the **audit and decision record** — the field-by-field
settability matrix (its §1–§8), owner rulings D1–D8 (its §10, §12, §14), the storage-model option
space (its §13), and the Arc 1 execution record (its §12.5–§14.9). Nothing here restates it; read it
for why, read this for what is left.

**Why a successor rather than a longer file.** The matrix began as a read-only audit and accreted
an execution arc, two decision sets and a design. At ~1,200 lines it held five documents with one
`status:`, so "is it done" had no answer — Arc 1 was complete while 29 rows were open. The audit is
finished and stable; the work it uncovered is not. Splitting on that seam gives each half a
lifecycle it can actually reach.

## What already landed (do not redo)

D8 Arc 1 — read and write now agree about where a resource lives. Eleven commits on
`feat/settability-parity`, `validate:all` 48/48.

| Landed                                                                               | Commit     |
| ------------------------------------------------------------------------------------ | ---------- |
| prompt writes resolve through `PathResolver`                                         | `f2abd9c5` |
| gate writes resolve through `PathResolver`                                           | `4fe5061f` |
| framework writes resolve; plus the loader-singleton and registry-loader read defects | `9e229e1e` |
| e2e coverage for the wiring, mutation-verified                                       | `d881dad2` |
| startup logs the resolved root and served count per resource type                    | `92cafa83` |

Styles were found to have **no** write path (`resource_type` is `z.enum(['prompt','gate','framework'])`),
so there was nothing to unify — P3.1 below is what would create one.

## Standing constraints

- **The server learns no "personal library" concept** (D8). The rule is: a write goes to the
  highest-precedence writable root, and the bundled tree always loads as fallback. A personal
  library is that mechanism configured, not a feature. No `target:` parameter.
  The second half of that rule was **aspirational until P1.0a** (2026-08-28): a workspace resource
  directory REPLACED the bundled tree rather than layering over it. It now holds for all four
  types.
- **Removing a union member is breaking** (CLAUDE.md §Public API Contract). P2 removes `dry_run`
  and `chain_step_operation:'replace'`; both need CHANGELOG breaking entries and ride the in-flight
  major.
- **No parity gates** (`cleanup-standards.md`). Replacements ship on and delete the old path in the
  same change.
- **Probes over `resources/prompts/` need `rg --no-ignore`** until P1.6 lands — **84** of 123
  prompts are untracked (authored 83; re-measured 2026-08-28 in the MAIN checkout, `123 - 39`).
- **Prompt-count probes must name the checkout.** A worktree checks out tracked files only, so
  every "on disk vs tracked" ratio is 39/39 here and 123/39 in main. Any P1 probe that compares the
  two runs against `/home/minipuft/Applications/claude-prompts-mcp`, never a worktree.

---

## P1 — Storage model, Arc 2

Closes the matrix's T1-F1, T1-F2, T1-F3, T1-F5 and P7-F4. Arc 1 made the four write paths agree
with the read paths; Arc 2 makes a write prefer the overlay, so a personal store is reachable.

**Blocking question first.** P1.0 gates P1.6 only; P1.1–P1.5 may proceed without it.
**Ruled 2026-08-28 — its premise was false, and answering it uncovered P1.0a.** See the two rows
below; the reasoning is in the implementation notes.

| #     | St                                                                                                                                                                                                                  | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Depends | Verification                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| P1.0  | ⚠ ✓ RULED (verified 2026-08-28 · premise false: `MCP_WORKSPACE` does NOT drive all three)                                                                                                                           | **No new env var.** `MCP_RUNTIME_ROOT` (`paths.ts:130`) already pins `runtime-state/` and relative `logs/` independently, so a personal library sets `MCP_WORKSPACE` and pins `MCP_RUNTIME_ROOT`. It must be `MCP_WORKSPACE`: overlay detection compares workspace to package root, so `MCP_RESOURCES_PATH` alone leaves overlays off                                                                                                                                                                                                                                                                                                                                                                                                      | —       | ruling in the implementation notes; `MCP_RUNTIME_ROOT` added to `src/index.ts` help and CLAUDE.md §Environment, where it was undocumented |
| P1.0a | ✓ (verified 2026-08-28 · a workspace holding one framework boots and serves the bundled 8; one prompt serves 40, not 1; an empty styles dir serves 4)                                                               | **A workspace resource dir REPLACED the bundled tree rather than overlaying it.** `resolveResourceSubdir` returns the first existing candidate and stops. Frameworks: `FATAL: Framework 'cageerf' not found`, process exits 1. Prompts/styles: silent subset. Fixed for all four types — bundled dir is now the lowest-precedence contributing root. Gates additionally had reads on `resolveGatesDir()` (package-only) while writes used `getGatesPath()`; both now resolve the same root                                                                                                                                                                                                                                                 | —       | `tests/e2e/bundled-resource-fallback.e2e.test.ts` — 5 assertions, all 5 red against the reverted fix                                      |
| P1.1  | ☐ (as of 2026-08-27 · flips when a prompt loaded from an overlay reports the overlay root and one from the bundle reports the package root)                                                                         | Loaded resources record their source root. Not recorded today — `PromptData.file` is a path relative to a base (`yaml-prompt-loader.ts:518`) and names no root                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | —       | a loaded prompt exposes its source root                                                                                                   |
| P1.2  | ☐ (as of 2026-08-27 · flips when an update to an overlay-resident prompt rewrites the overlay file and creates nothing under `server/resources/prompts`)                                                            | `update` writes to the source root; copy-on-write into the workspace when the source is the bundle and a distinct workspace exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | P1.1    | e2e: update an overlay-resident prompt, assert both halves                                                                                |
| P1.3  | ☐ (as of 2026-08-27 · flips when deleting a bundled prompt under a distinct workspace refuses and removes no file)                                                                                                  | `delete` of a bundled resource refuses, naming the shadow as the alternative. A shadow cannot express absence; sibling precedent is the built-in framework guard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | P1.1    | e2e: delete a bundled prompt under a workspace, assert refusal and that the file survives                                                 |
| P1.4  | ☐ (as of 2026-08-27 · flips when `rg "readCategoryShipStatus\|resolveCategoryShipStatus"` returns zero and the receipt names the write root)                                                                        | Receipt reports the write destination root; retire `category_ship_status` and `readCategoryShipStatus`, whose gitignore-parsing answer becomes structural                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | P1.2    | `rg` returns zero; a mutation receipt names the root                                                                                      |
| P1.5  | ✓ (verified 2026-08-29 · both consumers serve the personal store at `~/.claude/resources` merged over the bundled base)                                                                                             | Personal store moved outside every checkout, reached by `MCP_RESOURCES_PATH` set machine-locally in `~/.claude/settings.json` (plugin) and `~/.config/claude-prompts-catalog.env` (catalog). Executed as tier P1.5-X. The originals under `server/resources/prompts` remain in place — deleting them is P1.6                                                                                                                                                                                                                                                                                                                                                                                                                               | P1.0    | done: see tier P1.5-X                                                                                                                     |
| P1.6  | ☐ (as of 2026-08-29 · flips when the **main checkout** reports no `prompt.yaml` from `git status --ignored --porcelain server/resources/prompts`, AND the personal prompts load from a root outside every checkout) | ⚠ **premise corrected twice.** Move the 84 personal prompts to a store outside the repo (predecessor D5: `resources/prompts/` becomes bundled-only and fully tracked); delete `server/resources/prompts/.gitignore`. **Re-take the backup first** — done 2026-08-29, `backups/claude-prompts-mcp/resources-full-2026-08-29-001204.tar.gz`, verified 123/27/8/4. Authored falsifier compared tracked to on-disk, which is **vacuously equal (39 == 39) inside any worktree**. The 2026-08-28 re-anchor to "123 tracked" was itself wrong — it read the migration as moving prompts INTO git, when D5 moves them OUT — so the corrected check names both halves: nothing ignored remains here, and the personal store answers from elsewhere | P1.5    | in main: no ignored `prompt.yaml` under `server/resources/prompts`; the personal store serves the 84                                      |

**Gate P1**: a prompt authored from a worktree survives that worktree's removal, and
`server/resources/prompts` has no `.gitignore`.

### Tier P1.5-X — cut over to the personal library

Executes P1.5. Composed 2026-08-29 after establishing how the server is actually launched:
`claude --plugin-dir <repo>`, which reads `.mcp.json` at the plugin root. That file is **tracked and
shipped**, so it must not name a personal path — the cutover removes its resources line rather than
editing it, and the personal root moves to machine-local configuration.

Measured basis: with `MCP_RESOURCES_PATH` absent the server resolves `packageRoot/resources` and
serves the same 39 bundled prompts, so the line is redundant for dev and installed users alike.
With it supplied from the environment it serves 119 over the bundled base.

**Two consumers, not one.** The Claude Code plugin server is STDIO and per-conversation; the
`claude-prompts-catalog` systemd unit is long-lived HTTP on :9090. They cannot be one process — a
STDIO server has no port to share — so "one server" is unavailable, and the goal is one LIBRARY read
by both. Each keeps its own machine-local env source.

**Ordering is load-bearing**: every env flip is blocked on P1.5a. Main's `dist/` predates P1.0a, so
pointing any consumer at the personal store before rebuilding serves 84 prompts and silently drops
the 39 bundled ones.

| #     | St                                                                                                                                                                   | Change                                                                                                                                                                                                                                                                                                                                                                | Depends     | Verification                                                          |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| P1.5a | ✓ (verified 2026-08-29 · main's rebuilt `dist/` serves 120 against an external resources root, where the pre-rebuild binary served 81)                               | Landed `feat/settability-parity` on main by fast-forward and rebuilt `server/dist/`. **Not pushed** — ahead of `origin/main`, owner reviews pushes per push                                                                                                                                                                                                           | —           | done: same env, same binary path, 81 → 120                            |
| P1.5b | ✓ (verified 2026-08-29 · with no override the server resolves the identical directory and serves the identical count; a control with the old explicit value matches) | Removed the redundant resources path. ⚠ **Edited the wrong file first**: `.mcp.json` is a RENDERED projection of canonical `mcp.json` (`scripts/render-targets.json`), caught by `validate:render-drift`. Corrected at the source and re-rendered                                                                                                                     | P1.5a       | done: 120 from `<plugin>/server/resources/prompts` either way         |
| P1.5c | ✓ (verified 2026-08-29 · `ANTHROPIC_DEFAULT_HAIKU_MODEL` from `settings.json` is ABSENT in the `claude` process and PRESENT in both MCP subprocesses)                | `~/.claude/settings.json` `env` is the mechanism — Claude Code injects it into MCP subprocess environments rather than into its own. ⚠ The row called this unanswerable without a restart; it was answerable immediately by tracing a value already sitting in that block. `MCP_RESOURCES_PATH` added there, machine-local                                            | P1.5b       | done: propagation traced through a live subprocess                    |
| P1.5d | ✓ (verified 2026-08-29 · service active, its `/proc/<pid>/environ` names the personal root, and it serves a personal-only prompt over HTTP)                          | Catalog points at the same library via `~/.config/claude-prompts-catalog.env`. Also DELETED the unit's redundant `Environment=MCP_RESOURCES_PATH`, so precedence no longer depends on unit line order — the same shape as P1.5b                                                                                                                                       | P1.5a       | done: `action_plan` returns 200, a bogus id returns 404               |
| P1.5e | ✓ (verified 2026-08-29 · restarted plugin server logs 120 over the bundled base; a personal-only and a bundled-only prompt both resolve through the live tool)       | Restarted both consumers and verified each. Plugin server pids are new, carry `MCP_RESOURCES_PATH` injected from `settings.json`, and report `resource_root` as the personal store. `action_plan` (personal-only) and `create_framework` (category `examples`, absent from the personal store) both inspect successfully — a replacement would have failed the second | P1.5c P1.5d | done: both consumers, both directions                                 |
| P1.5f | ✓ (verified 2026-08-29 · zero tracked CONFIG or SOURCE files name a personal path)                                                                                   | Writeback. ⚠ **Falsifier was unsatisfiable as authored**: 14 tracked files already contain `/home/minipuft`, all `plans/**` reference prose quoting measured sessions, which is legitimate and permanent. Rescoped to config and source, where the count is 0                                                                                                         | P1.5e       | `git ls-files \| rg -l` for the path, minus `plans/`, returns nothing |

**Gate P1.5-X — PASSED (verified 2026-08-29).** Both consumers serve the personal library merged
over the bundled base, and no config or source file in the repo names a personal path. Proven in
both directions through the live tool, not only from logs: a personal-only prompt and a bundled-only
prompt each resolve, so the merge is distinguishable from a replacement.

**Filed, not done** — whether the :9090 catalog has a live consumer at all. No connections were
observed on it, and t3code's own tests reference a discovered endpoint on a different port
(`127.0.0.1:41000`) with `promptSourceId: "claude-prompts"`. That is a t3code integration question,
not a resource-surface one; P1.5d points the service at the right library either way.

**Gate P1 status — BLOCKED (as of 2026-08-28) on P1.5 and P1.6**, both owner actions: they relocate
the operator's own prompt library and commit 84 previously-untracked files. P1.0/P1.0a landed and
removed the precondition that made a personal store unusable — a workspace resource directory no
longer suppresses the bundled tree — but neither half of the gate criterion is satisfied by them.
Do not read the landed rows as progress toward this gate's text.

---

## P2 — Settability verbs

The matrix's rows 2, 3, 4 and 5b, plus SF-2. D1 established these are **one missing verb**
("remove"), not four defects; fixing them separately would produce four conventions for one verb.

| #    | St                                                                                                                              | Change                                                                                                                                                                                                                | Depends   | Verification                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| P2.1 | ☐ (as of 2026-08-27 · flips when `unset: ['system_message']` deletes `system-message.md` and drops the `systemMessageFile` key) | `unset: [keys]` parameter, reusing the `suppliedKeys` write-scope machinery. Closes rows 2 and 4 together and dissolves row 3's "empty array means no change"                                                         | —         | an update sending `unset` removes the key; `tools: []` still means "set to empty"    |
| P2.2 | ☐ (as of 2026-08-27 · flips when a delete preview runs without `confirm: true`)                                                 | `action: 'preview'` replaces `dry_run`, which is **removed**. Preview is not in `DESTRUCTIVE_ACTIONS`, so non-destructiveness is structural rather than a flag someone can get backwards — which is how SF-2 happened | —         | preview reaches dispatch with no `confirm`; `rg dry_run` returns zero                |
| P2.3 | ☐ (as of 2026-08-27 · flips when `tools: []` clears the on-disk id list AND a dropped id's `tools/{id}/` directory is removed)  | `tool_operation: 'add'\|'remove'` with directory deletion on explicit removal only, behind `confirm`. A narrowed `tools` array unbinds without deleting                                                               | P2.1      | a removal deletes the directory; a narrowed array does not                           |
| P2.4 | ☐ (as of 2026-08-27 · flips when an `update`-at-index operation exists and `'replace'` is gone from the enum)                   | `chain_step_operation: 'update'` at index; **remove** the vestigial `'replace'` no-op at `validation.ts:443`                                                                                                          | —         | a single step field edits without resending the array; `rg "'replace'"` returns zero |
| P2.5 | ☐ (as of 2026-08-27 · flips when `[Unreleased]` names both removals under a breaking heading)                                   | CHANGELOG breaking entries for `dry_run` and `'replace'`, per CONTRIBUTING §Breaking Changes                                                                                                                          | P2.2 P2.4 | `[Unreleased]` carries both                                                          |

**Gate P2**: the tool can express "remove this" for every clearable field, and preview is reachable
without confirming the thing being previewed.

---

## P3 — Styles as a resource type, and the systemMessage triage

Owner-proposed 2026-08-27. The matrix's §15 holds the measurement; the ruling was **not** "styles
replace `systemMessage`" but "`systemMessage` keeps only what is prompt-specific; anything
role-shaped becomes a style", with a testable criterion: _if the text would read identically for any
prompt in its category, it is a style._

| #    | St                                                                                                               | Change                                                                                                                                             | Depends   | Verification                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------- |
| P3.1 | ☐ (as of 2026-08-27 · flips when a `resource_manager` call writes a `style.yaml`)                                | `resource_type: 'style'` — lifecycle / discovery / versioning processors, schema, contract, router, mirroring the gate handler (~1,160 lines)      | —         | create/update/delete/inspect a style through the tool               |
| P3.2 | ☐ (as of 2026-08-27 · flips when the four `guidance/*` prompts carry no `systemMessageFile` and behave the same) | Pilot: retire the four `guidance/{reasoning,analytical,creative,procedural}` system messages, which restate the four shipped styles by name        | P3.1 P2.1 | the four prompts lose the key; their rendered guidance is unchanged |
| P3.3 | ☐ (as of 2026-08-27 · flips when `rg -c systemMessageFile` over the corpus returns 29)                           | Promote the remaining style-shaped system messages (23 under 40 words) into styles and strip them via `unset`, keeping the 45 prompt-specific ones | P3.2      | count drops to 29; no prompt loses per-prompt framing               |

**Gate P3**: a style is authorable through the tool, and no `systemMessage` remains that would read
identically for any sibling in its category.

**Explicitly not in scope**: removing `systemMessage` from `PromptYamlSchema`. It is a breaking
change to a Public API Contract surface, and the 12 substantial messages (`strategicImplement` at
1,347 words) have nowhere else to live.

---

## P4 — Deferred surface gaps

Carried from the matrix with their original falsifiers intact. Each is independently shippable;
none blocks another.

| #    | St                                                                                                                | Change                                                                                                                                                                                                               | Verification                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| P4.1 | ☐ (as of 2026-08-27 · flips when `framework_gates` appears in the contract with an element shape)                 | **SF-1** — `framework_gates` is hard-required by `FrameworkDraftValidator` but undeclared; its only published shape is an example inside an error response. Declaring it is **narrowing, not breaking**              | the contract names it; a caller can read its shape without a failed call |
| P4.2 | ☐ (as of 2026-08-27 · flips when a forced write failure leaves no new version row)                                | **SF-3** — framework `update` calls `recordEditResult` (`:160`) before `writeFrameworkFiles` (`:176`), so a failed write leaves a history row for an edit that never landed                                          | a forced failure leaves the ledger unchanged                             |
| P4.3 | ☐ (as of 2026-08-27 · flips when the deletion guard derives its set from the registry)                            | **SF-4** — `builtInFrameworks = ['cageerf','react','5w1h','scamper']` literal at `:244`, already wrong since `focus`, `liquescent`, `radiant` and `verify` also ship. The handbook forbids hardcoded framework lists | deleting a shipped framework not in the old literal is refused           |
| P4.4 | ☐ (as of 2026-08-27 · flips when a create/update call can author `severity`)                                      | Gate `severity` / `enforcementMode` / `gate_type` are in the loader schema but undeclared on `GateManagerInput`, so every tool-authored gate takes loader defaults silently                                          | a gate created through the tool carries a non-default `severity`         |
| P4.5 | ☐ (as of 2026-08-27 · flips when the 11 fields appear in `resourceManagerInputSchema`)                            | Framework's 11 "advanced" fields ride the outer `.passthrough()` — settable but undiscoverable to any client reading the schema                                                                                      | the fields are declared with descriptions                                |
| P4.6 | ☐ (as of 2026-08-27 · flips when `inspect format:'json'` returns the literal `arguments` and `chainSteps` arrays) | `inspect` never surfaces `arguments[].validation`/`defaultValue` or step `inputMapping`/`outputMapping`/`retries`/`visibility`/`delegation`, so a full-array rewrite reconstructed from it silently drops fields     | a round-trip through inspect loses nothing                               |
| P4.7 | ☐ (as of 2026-08-27 · flips when a tool call writes a `category.yaml`)                                            | `category` resource type — `CategorySchema` has zero writer in `src/`, so `category.yaml` is hand-authored today, which the MCP-Tooling-Only rule forbids                                                            | a category is authorable through the tool                                |
| P4.8 | ☐ (as of 2026-08-27 · flips when `user_message_template_file` or `system_message_file` resolves in `src/`)        | `create_prompt`'s `prompt_builder` emits parameter names `resource_manager` never reads, so file-referenced authoring through the guided workflow hard-fails validation                                              | the guided workflow completes in file-reference mode                     |

**Gate P4**: no field is required-but-undeclared, and no shipped resource kind is unauthorable.

---

## P5 — Corrections and hygiene

Findings from the Arc 1 execution that bind future work rather than belonging to it.

| #    | St                                                                                                                              | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Verification                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| P5.1 | ☐ (as of 2026-08-27 · flips when the served prompt count equals the on-disk count)                                              | Repair the three prompts that fail schema validation (`general/resume_variant_build`, `general/test_gate_chain`, `resume/resume_variant_build`) and the five with dropped inline gates. Two sit in untracked categories, so no CI can see them                                                                                                                                                                                                                                                                                                                                                                                                                                   | a startup logs zero `Invalid YAML` and zero `Dropped inline gate` |
| P5.2 | ☐ (as of 2026-08-29 · flips when the startup inventory line reconciles to the on-disk file count, naming each subtraction)      | Inventory reports load FAILURES, not just successes. **Measured 2026-08-29**: 123 `prompt.yaml` on disk, 119 served, and the gap has THREE causes, not one — 3 invalid YAML (`general/resume_variant_build`, `general/test_gate_chain`, `resume/resume_variant_build`), 5 ids duplicated across categories so the later load wins (`content_analysis`, `deep_analysis`, `initial_scan`, `note_refinement`, `resume_variant_build`), and 8 dropped inline gates across 6 prompts which cost no prompt but silently remove enforcement. A single "failed" count would still misreport this. Needs a count threaded through `CategoryPromptsResult` (`modules/prompts/types.ts:69`) | the line reads `119 (16 categories, 3 invalid, 5 shadowed)`       |
| P5.3 | ☐ (as of 2026-08-27 · flips when a server spawned through the shared helper answers `initialize` from inside jest)              | `spawnMcpServer` (`tests/e2e/helpers/plugin-test-helpers.ts:60`) passes `...process.env` unfiltered, so a child inherits `NODE_ENV`/`JEST_WORKER_ID` and silently declines to boot (`src/index.ts:815`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | the helper filters both vars                                      |
| P5.4 | ☐ (as of 2026-08-27 · flips when a response carrying `isError: true` is shown not to open with a success claim)                 | A create response was observed carrying `isError: true` while its body led with `✅ **Prompt Created**`. Observed directly; the captured body was truncated at 400 chars, so whether a later line qualifies it was NOT confirmed — verify before fixing                                                                                                                                                                                                                                                                                                                                                                                                                          | a failing mutation's first line states the failure                |
| P5.5 | ☐ (as of 2026-08-28 · flips when `npm run test:e2e` leaves `git status --untracked-files=all server/resources` empty)           | `claims-conformance.test.ts` leaves 7 `examples/conformance_*` prompt directories in the PACKAGE tree. `examples/` is tracked, so they surface as untracked rather than ignored, and a following `git add -A` commits them — which happened once already (14 fixtures, reverted at `d881dad2`). It also inflates the served prompt count: a probe read 47 instead of 40                                                                                                                                                                                                                                                                                                          | the suite cleans up unconditionally, including on failure         |
| P5.6 | ☐ (as of 2026-08-29 · flips when loading two prompts with the same id in different categories logs a warning naming both paths) | Five prompt ids exist in two categories each; the second load silently wins and the first is unreachable with nothing logged. A duplicate id is either a rename that never finished or a genuine collision, and both need to be visible. Distinct from P5.2, which reports counts — this reports identity                                                                                                                                                                                                                                                                                                                                                                        | a duplicate id warns, naming both source paths                    |

**Gate P5**: no gate or probe in this repo reports success for work that did not happen.

---

## Phase order

P1 and P2 are independent and may run in either order. P3.1 is independent; P3.2–P3.3 need P2.1
(`unset`) as their instrument, because the handbook forbids hand-editing under `server/prompts/**`.
P4 and P5 are unordered.

**P1 before P2.3** is the one real edge: P2.3 deletes directories under `resources/prompts/`, and
reviewing that diff is meaningless while 83 prompts are invisible to git (the D6 argument, scoped to
the row it actually reaches).
