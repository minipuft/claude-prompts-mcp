---
title: "Script tools — verification harness and the confirm-gate bypass"
date: 2026-08-17
status: reference
tags: []
---

# Script tools — verification harness and the confirm-gate bypass

Produced by `>>implementation_plan` (5 steps). Deviation log and ruling rationales live in the
sibling `-implementation-notes.md`; this file carries the contract only.

Sibling plan `skills-sync-export-fidelity-2026-08-17.md` owns the export subsystem — **retired to `plans/reference/technical-debt/` on 2026-08-18**, all 18 rows closed. This one owns
script tools. They share one lesson — a subsystem can reimplement a rule that already has a
canonical owner — and both cite ADR 0001 for it.

## Findings Ledger

| Id  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Verified                                                                                                                                   | Route       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| F1  | **SECURITY — `{{script:id}}` bypasses the confirm gate. REACHABLE IN A SHIPPED RESOURCE (measured 2026-08-19, live drive):** `>>reference_demo text:"..."` returns the script's real output AND a "Tool Confirmation" prompt for the same tool in one response — `word_count` declares `confirm: true` and is referenced inline at `reference_demo/user-message.md:29-30`. Stage 08 records `confirmationRequired` without halting; its only reader is `ResponseAssembler` at formatting, after stage 18 has already rendered. So the prompt is a caption on a completed action, not a gate. FIXED by row 3.3, which then breaks that demo — see row 3.6. Original: **`{{script:id}}` bypasses the confirm gate.** `ScriptReferenceResolver` never reads `tool.execution`; `execution.confirm` defaults to `true`, so a confirm-required tool executes unconditionally once a rendered template references it.                                                                                                                                                                                                                                               | `rg "confirm\|execution\|trigger" script-reference-resolver.ts` → every hit is a local variable (`executionCache`, `executionResult`)      | automation  |
| F2  | **The safety surface has zero tests on this path.** Timeout (SIGTERM→SIGKILL after 1s, `process.ts:363`), `SAFE_ENV_ALLOWLIST` (`process.ts:104`), and argv-not-shell spawning are unverified for script tools; covered only via the shell-verify gates path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `rg -l "executeProcess\|spawnProcess" tests/` → zero files                                                                                 | automation  |
| F3  | Failure semantics are asymmetric: declarative failures are swallowed and omit `tool_<id>`; inline failures throw and abort the pipeline. Two mental models for "a script failed" in one feature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | read `08-script-execution-stage.ts` vs `18-execution-stage.ts:252-261`                                                                     | automation  |
| F4  | `RUNTIME_COMMANDS` (`script-executor.ts:35`) declares `['python3','python']` but `findRuntimeCommand` (:311) always returns `commands[0]`, so every fallback entry is unreachable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | read both sites                                                                                                                            | automation  |
| F5  | Script output is uncapped (`truncateOutput: 0`, `script-executor.ts:153`) while the shell-gate verifier caps its own. A runaway script floods context with only the timeout as backstop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | read both sites                                                                                                                            | automation  |
| F6  | **RESOLVED UPSTREAM 2026-08-18 — no work remains here.** The canonical owner closed it: `SyncResult` now carries per-item failures, `syncTools` no longer reports a validation failure as a deletion, both `syncAll()` callers inspect the return, and the partial-cold fallback warns per tool. Original: **DUPLICATE — canonical owner is `skills-sync-export-fidelity-2026-08-17.md` F6.** Kept as a pointer so the id does not dangle. Cold `resource_index` makes tools export without `schema.json`/`tool.json`. Root cause lives upstream of both plans: both callers discard `SyncResult` from `await indexer.syncAll()`, so indexing errors are never inspected. Do not fix here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `loadToolsCache` warn path                                                                                                                 | skills-sync |
| F7  | **INVENTORY CORRECTED 2026-08-18 — there are FOUR, not three**: `workspace-script-loader.ts:65`, `converter.ts:78`, `module-initializer.ts:340`, `application.ts:811`. The original row named only `application.ts:811-813` for the indexer and missed `module-initializer.ts:340`. Both indexer sites were switched to `loadAllToolsForPromptDetailed` by the skills-sync run on 2026-08-18, so the two are now consistent with each other — but nothing was consolidated and the hot-reload coupling below still stands. Original: **Three independent `ScriptToolDefinitionLoader` instances**, each parsing `tool.yaml` with its own in-memory cache: one in `PromptConverter`, one inside `WorkspaceScriptLoader` (`prompt-executor.ts:258-264`), one built ad hoc for the indexer (`application.ts:811-813`). Only the first is wired to file-level hot-reload invalidation (`runtime/script-hot-reload.ts`). The other two are correct **only because** full-refresh happens to rebuild them from scratch — an implicit coupling, not an enforced invariant. A future change that stops rebuilding on refresh silently serves stale tool definitions. | Skip the rebuild on one refresh path; assert a stale definition is served                                                                  | automation  |
| F9  | **SECURITY — script output is treated as trusted template source.** `processTemplate` deliberately escapes any **argument** whose value contains `{{`, `{%` or `{#` (`jsonUtils.ts:170-182` → `escapeJsonForNunjucks`, `:13-21`). Script stdout never reaches that control: it is spliced into the **template itself** (`script-reference-resolver.ts:151-154`, reached via `jsonUtils.ts:358`) and then rendered by Nunjucks at `:368` with `autoescape: false`. Not RCE — the environment exposes no globals — but it yields cross-argument disclosure into the rendered prompt, template-loop DoS, and structural prompt injection. Trigger: any script whose stdout carries content its author does not fully control (`github_scout` emits `json.dumps` of remote GitHub data). **Same shape as F1**: a safety control present on the declarative path and absent on the inline one.                                                                                                                                                                                                                                                                    | Reproduced 2026-08-18 against the real nunjucks build: arg path renders `{{ api_key }}` literally, spliced path renders the secret's value | automation  |
| F10 | **The `script_tool` gate shells its tool id instead of running the tool.** Found 2026-08-19 while re-measuring F5's scope. `gate-validator.ts:388` passes `command: criteria.script_tool_id` as a string, and `resolveCommand` maps a string to `sh -c "<value>"`, so no script-tool lookup happens at all — the gate runs whatever that name means to a shell. Gate criteria are runtime-creatable through `resource_manager`, so the value reaching `sh -c` is not fixed at build time. Compounding: a missing `script_tool_id` returns `passed: true, score: 1.0`, and `create_gate/user-message.md:229` documents the type as "runs registered script". Not live — no shipped gate declares `script_tool`. Routed to Tier 6.                                                                                                                                                                                                                                                                                                                                                                                                                             | Read both sites 2026-08-19; `rg script_tool_id` across resources finds only the doc row and the schema                                     | automation  |
| F5b | **F5's uncapped-output scope was under-measured.** The finding named `script-executor.ts` only. The third `executeProcess` consumer (`gate-validator.ts:388`) also passes no `truncateOutput` AND field-accesses `result.parsed['passed']`, so it carries the identical silent-degradation shape row 4.2 fixed. Tier 4 fixed the script-tool half; the gate half is row 6.1's problem because that call site needs rewriting anyway.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Read the call site 2026-08-19                                                                                                              | automation  |
| F11 | **`script_tool` gates are inert end to end — the type enforces nothing and says nothing.** Found 2026-08-19 while driving F10's fix. Stage 20 (`20-gate-review-stage.ts`) is the ONLY live consumer of `pass_criteria`, and it delegates to `runGateShellVerifications`, which filters for `shell_verify`. `GateValidator`'s whole entry chain — `EngineValidator.validateWithGates` → `LightweightGateSystem.validateContent` → `validateGates` → `validateGate` — has **zero production callers**; `EngineValidator` is never constructed in `src/`. So the runner F10 describes, and the fixed runner row 6.1 shipped, are both dormant. Measured by drive: a gate declaring `script_tool` rendered as a heading with an empty body and created no sentinel. This makes F10 less urgent and 6.4 harder: the doc could not be repaired by fixing the code. **CLOSED by row 6.7** — the type is executed by gate review now, proven by a live drive in both polarities.                                                                                                                                                                                     | Live drive 2026-08-19 with a `tier6-probe` gate; `rg` for every caller of the four chain members                                           | automation  |
| F8  | **`tool.yaml` comments describe settings the file does not set.** `plugin_doctor/tools/doctor/tool.yaml:15` reads `# - confirm: true for fix operations (destructive)` with no `confirm:` key anywhere in the file — it relies on the global default while reading as a deliberate per-tool choice. Same shape in `prompt_builder/tool.yaml`. Harmless today because the default matches; actively misleading if the default ever changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Flip the global `confirm` default; assert the doc-comment claim no longer holds                                                            | automation  |

## Step 1 — Discovery & Triage

```
search_type   : targeted
sibling_patterns : tests/unit/gates/shell/shell-verify-executor.test.ts — same shared
                   executeProcess, real subprocess, real timeout assertions (:135-145).
                   No sibling exists for the confirm gate: shell-verify has no
                   confirmation concept (`rg "confirm|approval" src/engine/gates/shell/` → none).
domain_ownership : modules/automation/ owns detection + execution; engine/execution/reference/
                   owns inline resolution; shared/utils/process.ts is the shared spawn boundary
                   with TWO consumers.
                   CORRECTED 2026-08-19: THREE. `gate-validator.ts:386` imports it lazily
                   (`await import`), so the static-import search that produced "two" could not
                   see it. The missed consumer is the one carrying F10 and F5b. Reusable
                   lesson: an inventory built from static imports under-counts by exactly the
                   dynamic ones, and a dynamic import is what a rarely-exercised path looks like.
intent:
  work_type     : bug_fix
  secondary     : feature
  risk          : high — a safety control is absent on one of two paths; the shared executor
                  has a second consumer
  external_deps : none
  problem       : documented safety model with zero tests on this path and one control provably
                  absent → both paths enforce one contract, every claim pinned by a test that
                  fails when its control is removed
  next_phase    : testing
  confidence    : high
```

**Discovery finding that changes implementation**: `validate:python` is conditional on changed
paths and is not part of the Node test jobs, so python3 is not a guaranteed suite dependency.
Harness fixtures are written in **Node** — it runs the tests, so it cannot be absent. A python
fixture would skip silently on exactly the runs that matter.

## Step 2 — Design & Pre-flight

```
scope:
  objective     : Give the inline path the same confirm enforcement the declarative path has, by
                  injecting the existing decision through a port, and pin the safety surface with
                  a real-subprocess harness.
  success_signal: A confirm:true tool referenced as {{script:id}} does NOT execute on first
                  invocation and DOES after the user re-runs. Removing the guard fails exactly
                  one named test.
  non_goals     : editing shared/utils/process.ts (two consumers); redesigning
                  PendingConfirmationTracker; F3, F5, F6 (separate rows); adding a python3
                  dependency to the suite.

pre_flight:
  domain      : pass — ToolTriggerFilter is marked `@lifecycle canonical - Trigger/confirm filtering`
  layer       : pass WITH CONSTRAINT — resolver is engine/, confirm services are modules/;
                must cross via a port in shared/, never a direct import
  naming      : pass · complexity : pass (one guard clause) · size : n/a
  service     : pass — the service EXISTS; extend by injection, do not create
  defined     : pass — confirm decision defined in ToolTriggerFilter; reuse it
  contracts   : pass · pattern : pass · reuse-scope : pass
  persistence : n/a (in-memory, 5-min TTL) · lib-api / lib-version : n/a (node builtins)
  failures    : 0
  compound    : none

  identification:
    behavior  : Decides whether a given script tool may execute now for this prompt, and records
                a pending approval when it may not.
    state     : none in the port; the concrete impl holds the tracker's in-memory pending map
    shape     : interface (port) + thin adapter over the existing filter/tracker
    placement : shared/types/index.ts beside the existing port (CORRECTED by Step 3)
  alternatives:
    chosen    : reuse the existing port — one encoding of the confirm rule, no new layer edge
    rejected  : (a) import ToolTriggerFilter directly into the resolver — creates an
                engine/ → modules/ edge; (b) re-check tool.execution.confirm inline — a second
                encoding of an activation rule, the exact failure ADR 0001 exists for and that
                skills-sync is currently paying for; (c) declare inline refs exempt — leaves
                `confirm: true` meaning two different things by call site
```

## Step 3 — Verify-Paths

All eight probed files exist, none is a shim (line counts 75–482). Verified exact:
`ToolTriggerFilter` (tool-trigger-filter.ts:64), `requiresConfirmation` (:57), `recordPending`
(pending-confirmation-tracker.ts:93), `checkAndClearPending` (:134), `ScriptLoader`
(script-reference-resolver.ts:57), `ScriptExecutorPort` (:83), `scriptExecutor.execute` (:225),
`RUNTIME_COMMANDS` (script-executor.ts:35), `findRuntimeCommand` (:311), `truncateOutput: 0`
(:153), `SAFE_ENV_ALLOWLIST` (process.ts:104), `executeProcess` (:271), SIGTERM-then-SIGKILL
(:363), `timedOut` assertion (shell-verify-executor.test.ts:145).

```
drift_summary:
  files_with_major_drift: 1
  shims_detected: none
  revision_required: yes
```

**Correction 1 (major)** — Step 2 proposed creating `ScriptConfirmationPort` in
`engine/execution/reference/script-reference-types.ts`. `ToolTriggerFilterPort` **already exists**
at `src/shared/types/index.ts:408` and is already imported across the boundary by
`08-script-execution-stage.ts:29,58`. The seam exists, lives in `shared/`, and is proven to cross
engine→modules without a `validate:arch` violation. Reuse it; do not add a parallel port.
Constraint that came with it: the port's methods are detection-shaped
(`filterByTrigger(matches: ToolDetectionMatch[], …)`) while the resolver holds a script id and
inputs — see Q2.

**Correction 2 (minor)** — cite `pending-confirmation-tracker.ts:88-140`, not 88-115.

## Step 4 — Plan Table

### Tier 1: Characterization harness — pin current behavior before changing anything

| #   | St  | File                                                | Change                                                                          | ~Lines | Depends | Verify                         |
| --- | --- | --------------------------------------------------- | ------------------------------------------------------------------------------- | ------ | ------- | ------------------------------ |
| 1.1 | ✓   | tests/integration/scripts/fixtures/                 | Node fixtures: echo-inputs, sleep-long, exit-nonzero, print-non-json, print-env | 40     | —       | fixture returns JSON on stdin  |
| 1.2 | ✓   | tests/integration/scripts/script-subprocess.test.ts | Harness + happy path: real spawn through ScriptExecutor                         | 60     | 1.1     | jest --runInBand on the file   |
| 1.3 | ✓   | ↑                                                   | Timeout: sleep past the bound, assert `timedOut` + bounded wall-clock           | 25     | 1.2     | green; wall-clock < 3× timeout |
| 1.4 | ✓   | ↑                                                   | Env allowlist: parent secret absent from child env                              | 25     | 1.2     | green                          |
| 1.5 | ✓   | ↑                                                   | Argv-not-shell: `"; touch <tmp>"` produces no side effect                       | 20     | 1.2     | tmp file absent                |
| 1.6 | ✓   | ↑                                                   | Non-JSON stdout wraps to `{output}`; non-zero exit → `success:false`            | 25     | 1.2     | green                          |

**Tier 1 gate**: `npm run typecheck && NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBand tests/integration/scripts`

### Tier 2: Reproduce the bypass — must FAIL on current code

| #   | St  | File | Change                                                                                                                            | ~Lines | Depends | Verify                  |
| --- | --- | ---- | --------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | ----------------------- |
| 2.1 | ✓   | ↑    | Declarative control: `confirm:true` via Stage 08 returns ConfirmationRequired                                                     | 30     | 1.2     | green on current code   |
| 2.2 | ✓   | ↑    | **Reproduction (F1)**: `{{script:id}}` to the same tool — assert it does NOT execute                                              | 30     | 2.1     | **RED on current code** |
| 2.3 | ✓   | ↑    | **Reproduction (F9)**: fixture emits `{{ other_arg }}` on stdout — assert it renders LITERALLY, not as the other argument's value | 25     | 1.2     | **RED on current code** |

**Tier 2 gate**: 2.2 AND 2.3 must fail, each for its stated reason (2.2: fixture side-effect
observed; 2.3: the secret value appears in the rendered output). A green 2.2 or 2.3 before Tier 3
means the test is wrong, not the code. **SUPERSEDED 2026-08-19.** That sweep was wrong: it ran through a shell function aliasing
`grep` to `ugrep`, which silently missed `resources/prompts/examples/reference_demo/`. Re-measured
with `rg`: **`reference_demo/user-message.md:29-30` uses `{{script:word_count}}` and
`{{script:word_count.word_count}}`**, and `word_count/tool.yaml:23` sets `confirm: true`. F1 and F9
are therefore reachable from a shipped resource, not hardening-before-use. The fixtures still
construct their own reference, which remains correct for isolation.

### Tier 3: The fix — reuse the existing port

| #   | St  | File                                     | Change                                                                                                                                                                                                                                                                                                                                                                                            | ~Lines | Depends  | Verify                           |
| --- | --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | -------------------------------- |
| 3.1 | ✓   | shared/ (new pure fn)                    | Promote `extractExplicitToolRequests` out of `ToolDetectionService` (`:140`, `private`) into a shared pure function. ONE encoding of the `tool:<id>` rule                                                                                                                                                                                                                                         | 15     | Q2 ruled | typecheck; detection tests green |
| 3.2 | ✓   | .../tool-detection-service.ts:95         | Call the shared function; delete the private copy                                                                                                                                                                                                                                                                                                                                                 | 5      | 3.1      | existing detection tests green   |
| 3.3 | ✓   | .../script-reference-resolver.ts:~218    | Guard before `scriptExecutor.execute`: if `tool.execution.confirm !== false` and the shared fn does not find `tool:<id>` in `context`, throw a confirmation-required error naming the opt-in. No port, no injection, no new state                                                                                                                                                                 | 25     | 3.2      | 2.2 flips GREEN                  |
| 3.4 | ✓   | .../script-reference-resolver.ts:151-154 | **F9**: wrap script output in `{% raw %}...{% endraw %}` before splicing into `resolvedTemplate`. NOT `escapeJsonForNunjucks` — measured 2026-08-18, that escape is half of an escape/unescape pair keyed to the arg it escaped, so on the splice path it leaves literal backslashes (`\{\{ api_key \}\}`) in the output. Raw-wrapping renders correctly. Handle output containing `{% endraw %}` | 8      | 2.3      | 2.3 flips GREEN                  |
| 3.5 | ✓   | ↑ test file                              | Approval path: same command WITH `tool:<id>` → executes                                                                                                                                                                                                                                                                                                                                           | 20     | 3.3      | green                            |

**Rows 3.1/3.2/3.4 of the pre-ruling plan are DELETED, not deferred.** They added a method to
`ToolTriggerFilterPort`, implemented it over the tracker, and threaded the concrete filter through
the composition root. Q2's measurement removed the need for all three: the resolver already holds
`args`. No new layer edge is created, so the `validate:arch` risk row below is now inapplicable.

| 3.6 | ✓ | resources/prompts/examples/reference_demo/ | **BLOCKS THE TIER 3 GATE — owner ruling required.** The 3.3 guard breaks the shipped `reference_demo` prompt. Measured 2026-08-19 against the real `tool.yaml` via `ScriptToolDefinitionLoader`: `word_count` resolves to `{"trigger":"schema_match","confirm":true,"strict":false}`, `reference_demo` supplies only `text`/`topic`, so rendering now throws `ScriptConfirmationRequiredError`. **RULED 2026-08-19 (owner): split into two tools, all four cells.** `word_count` -> `confirm: false` (automatic on both routes), new sibling `text_digest` -> `confirm: true` (waits declaratively, refuses inline until named). Rationale beyond the fix, and the owner's: `reference_demo` becomes the FIRST shipped prompt declaring two tools — measured 2026-08-19, all 7 tool-declaring prompts declare exactly one, and no test exercised two tools for one prompt end to end. The pair is now the regression test that `confirm` is per-tool and route-independent, which a single-tool prompt structurally cannot show. Covered by `tests/integration/scripts/multi-tool-resource.test.ts` (4 cases, reading the real resource files). | ~5 | 3.3 | `>>reference_demo text:"..."` renders without an opt-in, or the demo documents the opt-in |
| 3.7 | ✓ | server/knip.json (DONE, kept as record) | Executable fixtures are spawned by path and never imported, so knip counted all seven as unused files and `validate:knip-ratchet` failed 16→24. Added `tests/integration/scripts/fixtures/**` to `ignore`. **This means commit `1d2ae383` (Tiers 1-2) would have failed CI**; the fix rides Tier 3. | 4 | — | `npm run validate:knip-ratchet` |
| 3.8 | ✓ | tool.yaml comments across examples | **F8, third instance, different shape.** `word_count/tool.yaml:20` states `confirm: true \| false (default: false)` while `ToolDetectionService:113` defaults it to `true`. F8 recorded comments claiming a key the file lacks; this one states a default the code contradicts, which is what made `reference_demo` ship a confirm-required tool that looks optional. Sweep every example tool.yaml. | 10 | — | grep every tool.yaml default claim against the code default |

**Tier 3 gate — PASSED 2026-08-19** (row 3.6 ruled and implemented; was blocked by it). All commands pass as of 2026-08-19: `typecheck` clean, `lint:ratchet` OK (3169/1007, no regressions), `typecheck:tests:ratchet` OK (371), `validate:arch` OK (0 errors, 471 modules), `test:ci` 2674 passed / 1 skipped, `validate:all` 44/44 after the 3.7 knip fix, and the tier's own suite 6/6. `validate:all` re-run after the 3.6 split: **44/44 PASS**. The demo now renders by default and the guard still refuses `text_digest` inline. Tier 4 (4.1, 4.2) and Tier 5 (5.1, 5.3, 5.4) remain OPEN by owner decision — this pass took 3.6 and 3.8 only.

### Tier 4: Independent defects (parallel-safe after Tier 1)

| #   | St  | File                   | Change                                                                                                                                                                                                                                                                 | ~Lines | Depends  | Verify                                          |
| --- | --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | ----------------------------------------------- |
| 4.1 | ✓   | script-executor.ts:311 | `findRuntimeCommand` falls back when `commands[0]` absent                                                                                                                                                                                                              | 12     | 1.2      | test with missing first binary                  |
| 4.2 | ✓   | script-executor.ts:153 | Cap `truncateOutput`, AND return `success:false` naming the cap when truncation occurred — a truncated result cannot be field-accessed, so reporting it as a degraded success is a silent failure                                                                      | 20     | Q3 ruled | test asserts BOTH the cap and the loud failure  |
| 4.3 | ✓   | process.ts:471         | **Added mid-execution.** `truncate` under-reported the dropped count: the streaming slice discards down to `2×cap` before `truncate` runs, so its count was bounded by the cap itself — a 20k overrun under a 500 cap reported "500 chars". Count the pre-slice losses | 8      | 4.2      | test asserts the reported count exceeds the cap |

**Anchors re-measured 2026-08-19**: `findRuntimeCommand` is at :311 and `truncateOutput: 0` at
:153, both exactly as authored. No drift.

**Tier 4 gate**: ~~`npm run test:ci`~~ — **VACUOUS, substituted.** `test:ci` is defined as
`npm run test:unit` (`package.json:86`), which reads `tests/unit` only, so it cannot observe a
single file this tier wrote. Substituted: `jest tests/integration/scripts tests/unit/scripts
tests/unit/gates/shell` (218 passed, includes the second `executeProcess` consumer whose
truncation-message assertion this tier could have broken) plus `npm run validate:all`. **This
affects every earlier tier too** — Tiers 1-3 also wrote only integration tests, so their stated
gate was equally blind. See row 6.3.

### Tier 5: Record and document

| #   | St  | File                              | Change                                                                                                                                                                                                                                                                                                                               | ~Lines | Depends       | Verify                                              |
| --- | --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------- | --------------------------------------------------- |
| 5.1 | ✓   | this file                         | Keep ledger current as tiers land                                                                                                                                                                                                                                                                                                    | —      | —             | prettier                                            |
| 5.2 | ✓   | -implementation-notes.md          | Deviation log — created BEFORE Tier 1's first edit                                                                                                                                                                                                                                                                                   | 25     | —             | exists before 1.1                                   |
| 5.3 | ✓   | ↑ notes                           | Falsification record: mutation + which test failed, per claim                                                                                                                                                                                                                                                                        | 20     | 3.5, 4.1      | one row per claim                                   |
| 5.4 | ✓   | CHANGELOG.md                      | Fixed entry                                                                                                                                                                                                                                                                                                                          | 3      | 3.4           | commitlint                                          |
| 5.5 | ✓   | docs/reference/template-syntax.md | **Added mid-execution.** The doc framed `{{script:id}}` as "Data Fetching" with no mention of approval, output limits, or escaping — accurate before 3.3/3.4, false after. Added an Approval subsection and an output-limits subsection                                                                                              | 35     | 3.3, 3.4, 4.2 | doc states the refusal and the `tool:<id>` approval |
| 5.6 | ✓   | docs/guides/script-tools.md       | **Added mid-execution.** Two defects: `confirm: false # Require user confirmation` describes the opposite of its value and omits that the default is `true` (F8's shape, in the guide rather than a `tool.yaml`); and the Auto-Execute-vs-Inline comparison table had no confirmation row, which was accurate-by-omission before 3.3 | 15     | 3.3           | table carries a `confirm` row                       |

**Tier 5 gate**: `npm run validate:all`

### Tier 6: Discovered during Tier 4 — the third `executeProcess` consumer

Tier 4 re-measured the plan's "shared spawn boundary with TWO consumers" and found **three**.
The third, `gate-validator.ts:386`, uses a lazy `await import`, so a static-import search does not
see it — and it carries the same two defects Tier 4 just fixed for script tools, plus one of its
own. None of this is reachable today (no shipped gate declares `script_tool`), which is why it is
a tier of its own rather than a stop-the-line finding.

| #   | St  | File                                                                                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ~Lines | Depends  | Verify                                                                                                                   |
| --- | --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| 6.1 | ✓   | gate-validator.ts:368                                                                | **Routed through the registry.** `runScriptToolVerify` now resolves `script_tool_id` via the injected `ScriptLoader` and runs the tool through `ScriptExecutorPort` — the same two ports the inline path uses, injected because `engine/` may not value-import `modules/`. The `executeProcess({command: <string>})` call is gone, so the `sh -c` sink no longer exists on this path. Also refuses a `confirm`-required tool: a gate is not a caller and has no channel to approve one. `script_tool_working_dir` stays relative to the tool's own directory | 40     | —        | ✓ a gate naming `verdict_tool` runs the fixture (marker in details); a gate naming `touch <sentinel>` leaves no sentinel |
| 6.2 | ✓   | gate-validator.ts:374                                                                | **Fails closed.** Missing id, unresolvable id, confirm-required tool, and no wired runtime all return `passed: false, score: 0` with a named reason, via one `unrunnableScriptTool` helper                                                                                                                                                                                                                                                                                                                                                                   | 8      | 6.1      | ✓ `a missing script_tool_id does not score 1.0`                                                                          |
| 6.3 | ✓   | package.json:78-86, .husky/pre-push                                                  | **CLOSED by `639fe268`.** Integration tests run at pre-push as step 6b, with the git-env scrub as a stated precondition (git exports `GIT_DIR` into every hook, and `yaml-corpus.test.ts` calls `git ls-files`). E2E stays CI-only with a narrowed residual                                                                                                                                                                                                                                                                                                  | 15     | —        | ✓ a broken integration test now fails a local gate                                                                       |
| 6.4 | ✓   | create_gate/user-message.md:229, gates.md:15,347, gate-schema.ts, gate-primitives.ts | **Corrected twice, which is the point.** The row assumed the doc becomes true once 6.1 lands; F11 showed no live path ran `script_tool` at all, so it was first corrected to **Not enforced**. Row 6.7 then made the type genuinely live and the docs moved back to **Enforced** — this time describing behavior a drive can observe. The intermediate state was not wasted work: it is what stopped a false claim shipping in between                                                                                                                       | 3      | 6.1, 6.7 | ✓ claim matches the drive                                                                                                |

| 6.5 | ✓ | script-reference-resolver.ts:55 | **`{% raw %}`-aware.** `rawBlockRanges()` computes the block spans and `detectScriptReferences` skips any match inside one; an UNCLOSED `{% raw %}` covers the rest of the template, because Nunjucks rejects such a template either way and a side effect before a guaranteed parse error is the worse outcome. `reference_demo`'s summary table now carries real `{{script:...}}` syntax again, inside a raw block | 25 | — | ✓ live drive: the raw cells render literally and execute nothing; the unwrapped reference still runs |
| 6.6 | ✓ | docs/reference/template-syntax.md:105,108 | **De-spaced.** Both examples are now `{{script:...}}`, plus a line stating that the resolver matches `{{script:` literally and that a spaced form fails the whole render rather than rendering nothing. The Escaping section gained the raw-block example from 6.5 | 2 | — | ✓ the examples match the regex the resolver uses |

| 6.7 | ✓ | 20-gate-review-stage.ts, gate-script-tool-runner.ts, script-tool-criterion-runner.ts, gate-schema.ts | **F11 closed — option (a), wired in.** `script_tool` now runs during gate review beside `shell_verify`, via a new `runGateScriptToolVerifications`. The rule for what a criterion MEANS was extracted to `runScriptToolCriterion` and shared with `GateValidator`, so the live path and the dormant one cannot drift — writing it twice is how this subsystem produced its original defect. The coverage decision needed no change: it reads only `gateId` and `passed`, so it was already mechanism-agnostic. Unenforceable criteria are refused at load (`shell_verify` with no command, `script_tool` with no id), which is breaking and folded into this release's major | 120 | — | ✓ live drive, both polarities |

**Tier 6 gate**: `npm run validate:all`, plus a drive of an actual `script_tool` gate — the
feature has never been exercised end to end, which is how 6.1 survived.

**Tier 6 gate result (2026-08-19)**: `validate:all` 44/44 · 743 integration · 2674 unit · 148
e2e. The drive was run and is what produced F11: a temporary `tier6-probe` gate declaring
`script_tool_id: "touch <sentinel>"` was attached to a real `>>reference_demo` run against a
freshly built `dist/`. The gate appeared in the response as a heading with an empty body, and
the sentinel was never created — so the criterion neither ran the shell (6.1's fix holds at the
server, not only in tests) nor ran anything else. The probe was removed after the drive.

### New file justifications

- `tests/integration/scripts/script-subprocess.test.ts` — every existing scripts test mocks
  `ScriptExecutor.execute`; adding real spawns to one would change the mock boundary for tests
  that deliberately have none. It also needs extended jest timeouts (real `sleep`), which would
  slow the existing fast suites.
- `tests/integration/scripts/fixtures/*.js` — executable fixtures cannot live inside a `.test.ts`;
  a real interpreter needs real files on disk.

### Execution Dispatch

| Work                                                                                             | Agent       |
| ------------------------------------------------------------------------------------------------ | ----------- |
| Tier 1 (1.1–1.6)                                                                                 | sonnet      |
| Tier 2 (2.1–2.2) — must report the RED result verbatim, not "fix" it                             | sonnet      |
| Tier 3 (3.1–3.5) — decision-bearing: safety control plus a shared port with an existing consumer | opus        |
| Tier 4 (4.1)                                                                                     | sonnet      |
| Tier 5 (5.1–5.4)                                                                                 | sonnet      |
| Q rulings, Tier-2 red acceptance, Tier-3 acceptance, `verify:mcp` live drive, final scope check  | main thread |

## Open Questions

| Id  | Status           | Must precede | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | RULED 2026-08-18 | Tier 3       | Inline refs DO honor `confirm`, enforced through the **existing stateless `explicitRequest` channel** — a `confirm: true` tool referenced inline blocks until the invocation names `tool:<id>`. The re-run tracker is NOT extended to the inline path. Elicitation is the eventual answer, deferred to a follow-up plan (see Q1-note).                                                                                                   |
| Q2  | RULED 2026-08-18 | 3.1          | **No port change.** Measured: the resolver already receives `args` — `jsonUtils.ts:353` builds `combinedContext = { ...specialContext, ...args }` and passes it to `preResolve`. `ToolTriggerFilterPort` is untouched. Instead promote `ToolDetectionService.extractExplicitToolRequests` (currently `private`, `tool-detection-service.ts:140`) to a pure function in `shared/` so the extraction rule has ONE encoding.                |
| Q3  | RULED 2026-08-18 | 4.2          | Cap output AND treat truncation as failure. Measured: `tryParseJson` runs on the already-truncated string (`process.ts:411` then `:426`), so a silent cap degrades a structured result to an unparsed string and breaks `{{script:id.field}}`. An over-cap result returns `success:false` naming the cap. The cap is a **robustness** control, not a security boundary — a script author already has arbitrary code execution by design. |

**Q1-note — why not elicitation now.** A spike on 2026-08-18 confirmed elicitation is viable on both halves:
`@modelcontextprotocol/server` 2.0.0 exports `inputRequired` / `acceptedContent` / `isInputRequiredResult`,
and constructing a confirm elicitation emits a valid form-mode `elicitation/create` (executed, not read).
Claude Code 2.1.234 advertises `elicitation: {}` and renders form + URL modes through a queue whose action
label is `"Skip confirmation"`. The server negotiates protocol revision 2026-07-28, so it is in-era.

It is deferred because `inputRequired` is a **tool-handler return value**, and the confirm decision happens
deep inside — stage 08, or the resolver during template rendering. There is no upward input-required channel
through the 22-stage pipeline. Building one is materially more than this plan's Tier 3, and the SDK warns
that `requestState` returns as attacker-controlled input requiring HMAC/AEAD that it does not provide.
A follow-up plan owns consent architecture across all three current encodings (`explicitRequest`, the re-run
tracker, and the seven agent-settable `confirm?: boolean` parameters on the MCP tool surface — a caller-set
boolean is satisfiable by the model, so real consent today comes from the host's permission prompt, a control
this server neither owns nor can verify). The live round-trip remains UNPROVEN: the spike produced structural
evidence on the client and executed evidence on the SDK, never an end-to-end drive.

## Step 5 — Validation & Completion

### Testing strategy

| What to test                        | Test type   | Location                           | Why this type                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------- | ----------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timeout, env allowlist, argv-safety | integration | script-subprocess.test.ts          | The claims are about a real OS process; a mock cannot exhibit SIGKILL                                                                                                                                                                                                                                                                                                                   |
| Confirm parity across both paths    | integration | script-subprocess.test.ts          | The defect is a boundary difference between two callers of one service                                                                                                                                                                                                                                                                                                                  |
| Port method contract                | unit        | tool-trigger-filter.test.ts        | Pure decision over injected state; extends the existing suite                                                                                                                                                                                                                                                                                                                           |
| ~~Runtime fallback (F4)~~ ⚠         | ~~unit~~    | ~~script-executor.test.ts~~        | ~~Single function, no I/O once the binary lookup is injectable~~                                                                                                                                                                                                                                                                                                                        |
| Runtime fallback (F4) — CORRECTED   | integration | script-executor-robustness.test.ts | The lookup was NOT made injectable, deliberately. The property is "does the interpreter the child receives resolve on the PATH the child receives", and an injected lookup cannot observe it — it would assert that a stub returned what the stub was told to return. The tests build a throwaway PATH holding fake interpreters and read back which one ran from its own stdout marker |

### Done criteria

| Criterion                      | Validation                                                                         | Pass condition                     |
| ------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------- |
| Bypass fixed                   | Tier 2.2 test                                                                      | RED before Tier 3, GREEN after     |
| Guard is observed              | revert 3.3, re-run                                                                 | exactly one named test fails       |
| No new layer edge              | `npm run validate:arch`                                                            | passes                             |
| No regression                  | `npm run validate:all`                                                             | passes                             |
| Real behavior, not green gates | `npm run build && npm run verify:mcp`, then drive a confirm-required tool via `>>` | blocks, then executes after re-run |

### Documentation

| Doc                                        | Update needed                                                       | Status                                                                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CHANGELOG.md                               | Fixed + Security entries                                            | ✓ 5.4                                                                                                                                                                                                 |
| ~~docs/reference/prompt-yaml-schema.md~~ ⚠ | ~~State that `execution.confirm` applies to both invocation paths~~ | **Wrong target.** That doc covers `prompt.yaml` fields and never mentions `execution.confirm`, which is a `tool.yaml` field. Landed in the two docs that do own it, neither of which this table named |
| docs/reference/template-syntax.md          | Approval, output limits, escaping for `{{script:id}}`               | ✓ 5.5 — the doc the plan missed                                                                                                                                                                       |
| docs/guides/script-tools.md                | `confirm` default claim + the Auto-Execute-vs-Inline comparison row | ✓ 5.6                                                                                                                                                                                                 |
| docs/architecture/overview.md              | Only if the port gains a method worth naming in the stage map       | n/a — Q2 ruled no port change                                                                                                                                                                         |

### Risks

| Risk                                                                               | Impact                                                  | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Rollback                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Editing the shared port breaks Stage 08                                            | Script auto-execution stops                             | Additive method only; existing filter tests as canary                                                                                                                                                                                                                                                                                                                                                                                                                            | revert 3.1–3.2             |
| Confirm on inline refs breaks builder prompts                                      | create_prompt/create_gate/create_framework stop working | They set `autoApproveOnValid: true` — verify that path explicitly in 3.5                                                                                                                                                                                                                                                                                                                                                                                                         | Q1 fallback: exempt inline |
| Real-subprocess tests flake in CI                                                  | Red builds unrelated to the change                      | Node fixtures only; generous timeout margins                                                                                                                                                                                                                                                                                                                                                                                                                                     | mark the file serial       |
| ~~`process.ts` change leaks into shell-verify~~ ⚠ **PREMISE FALSIFIED 2026-08-19** | Gate verification breaks                                | ~~process.ts is assertion-target-only, never edited~~ — **Tier 4 edited it**: `stdoutTruncated`, dropped-char accounting, and `resolveExecutable`. Actual mitigation: every change is additive (a new optional field, a new exported function, a defaulted parameter), and the shell-verify suite runs inside this tier's substituted gate. Its one truncation-message assertion is a `toContain('[...truncated')` prefix match, so the corrected char count does not disturb it | revert `process.ts`        |

### Release

```
commit_convention : fix(execution): honor execution.confirm for inline script references
scope             : execution
```

### Growth capture

- [ ] Pattern: a subsystem reimplementing a rule that already has a canonical owner — third sighting (gate activation in skills-sync F1, gate re-add in F2, confirm here). At three independent sightings this is a candidate for promotion to a rule.
- [ ] Memory: the `rg -r` flag silently rewrites match output — it destroyed a symbol name during Step 3 verification and would have been readable as fact if pasted uncritically.
- [ ] Skill: `/testing` could name "test the emitted artifact, not the generator source" explicitly.

### Changelog entry

**SUPERSEDED 2026-08-19 — the shipped entries are in `CHANGELOG.md` under Unreleased.** The draft
below was written before Q1 and Q2 were ruled and states two things the implementation does not
do: approval is by naming `tool:<id>` in the invocation, **not** by re-running the command, and
the two paths do not share `ToolTriggerFilterPort` — Q2 ruled no port change, and they instead
share the extracted `extractExplicitToolRequests`. Kept because the error is the reusable part:
a changelog drafted at planning time describes the plan, and the plan is what the open questions
were still free to change.

> ~~**Fixed** — Inline `{{script:id}}` template references now honor a script tool's
> `execution.confirm` setting. Previously only the declarative `tools:` path enforced confirmation,
> so a tool declaring `confirm: true` executed unconditionally the moment a rendered template
> referenced it; `confirm` defaults to true, so this affected every tool that had not explicitly
> opted out. Both paths now resolve confirmation through the same `ToolTriggerFilterPort`, and
> approval works the same way: re-run the command.~~

### Execution record — Tiers 4 and 5 (2026-08-19)

**Measured against what was authored:**

| Assertion                                             | Authored                 | Measured                                                        |
| ----------------------------------------------------- | ------------------------ | --------------------------------------------------------------- |
| `findRuntimeCommand` anchor                           | `script-executor.ts:311` | :311 — exact                                                    |
| `truncateOutput: 0` anchor                            | `script-executor.ts:153` | :153 — exact                                                    |
| `executeProcess` consumers                            | two                      | **three** — `gate-validator.ts:386` imports it lazily           |
| Tier 4 gate observes Tier 4's files                   | assumed                  | **no** — `test:ci` reads `tests/unit` only; substituted         |
| `process.ts` would not be edited                      | "assertion-target-only"  | **edited** — three additive changes                             |
| F4 testable as a unit with an injectable lookup       | assumed                  | **no** — the property needs a real PATH; written as integration |
| `prompt-yaml-schema.md` documents `execution.confirm` | assumed                  | **no mention** — the field lives in `script-tools.md`           |

**Substituted checks**: the Tier 4 gate (`npm run test:ci`, vacuous — see row 6.3) was replaced
by `jest tests/integration/scripts tests/unit/scripts tests/unit/gates/shell` (218 passed) plus
`npm run validate:all` (44/44) and `npm run build`. The shell-verify suite is included
deliberately: it is the second `executeProcess` consumer and the only existing test that reads
the truncation message this tier changed.

**Falsified**: seven mutations, seven distinct named failures — see the Tier 4 falsification
record in the implementation notes.

**Still open**: nothing. Every row across all six tiers is terminal. F11 was ruled by the owner
on 2026-08-19 — wire it in, keep the JSON criteria as a capability with `shell_verify` as the
simpler default, refuse unenforceable criteria at load, fold the breaking half into the release
already being cut. The post-fix live drive named in Done criteria is
done: driven 2026-08-19 against a rebuilt `dist/` via a spawned stdio server, which is what
`verify:mcp` does and what removes the MCP-restart dependency the earlier note assumed.
