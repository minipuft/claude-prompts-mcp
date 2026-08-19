---
title: "Script tools — verification harness and the confirm-gate bypass"
date: 2026-08-17
status: backlog
tags: []
---

# Script tools — verification harness and the confirm-gate bypass

Produced by `>>implementation_plan` (5 steps). Deviation log and ruling rationales live in the
sibling `-implementation-notes.md`; this file carries the contract only.

Sibling plan `skills-sync-export-fidelity-2026-08-17.md` owns the export subsystem — **retired to `plans/reference/techincal_debt/` on 2026-08-18**, all 18 rows closed. This one owns
script tools. They share one lesson — a subsystem can reimplement a rule that already has a
canonical owner — and both cite ADR 0001 for it.

## Findings Ledger

| Id  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Verified                                                                                                                                   | Route       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| F1  | **SECURITY — `{{script:id}}` bypasses the confirm gate.** `ScriptReferenceResolver` never reads `tool.execution`; `execution.confirm` defaults to `true`, so a confirm-required tool executes unconditionally once a rendered template references it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `rg "confirm\|execution\|trigger" script-reference-resolver.ts` → every hit is a local variable (`executionCache`, `executionResult`)      | automation  |
| F2  | **The safety surface has zero tests on this path.** Timeout (SIGTERM→SIGKILL after 1s, `process.ts:363`), `SAFE_ENV_ALLOWLIST` (`process.ts:104`), and argv-not-shell spawning are unverified for script tools; covered only via the shell-verify gates path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `rg -l "executeProcess\|spawnProcess" tests/` → zero files                                                                                 | automation  |
| F3  | Failure semantics are asymmetric: declarative failures are swallowed and omit `tool_<id>`; inline failures throw and abort the pipeline. Two mental models for "a script failed" in one feature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | read `08-script-execution-stage.ts` vs `18-execution-stage.ts:252-261`                                                                     | automation  |
| F4  | `RUNTIME_COMMANDS` (`script-executor.ts:35`) declares `['python3','python']` but `findRuntimeCommand` (:311) always returns `commands[0]`, so every fallback entry is unreachable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | read both sites                                                                                                                            | automation  |
| F5  | Script output is uncapped (`truncateOutput: 0`, `script-executor.ts:153`) while the shell-gate verifier caps its own. A runaway script floods context with only the timeout as backstop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | read both sites                                                                                                                            | automation  |
| F6  | **RESOLVED UPSTREAM 2026-08-18 — no work remains here.** The canonical owner closed it: `SyncResult` now carries per-item failures, `syncTools` no longer reports a validation failure as a deletion, both `syncAll()` callers inspect the return, and the partial-cold fallback warns per tool. Original: **DUPLICATE — canonical owner is `skills-sync-export-fidelity-2026-08-17.md` F6.** Kept as a pointer so the id does not dangle. Cold `resource_index` makes tools export without `schema.json`/`tool.json`. Root cause lives upstream of both plans: both callers discard `SyncResult` from `await indexer.syncAll()`, so indexing errors are never inspected. Do not fix here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `loadToolsCache` warn path                                                                                                                 | skills-sync |
| F7  | **INVENTORY CORRECTED 2026-08-18 — there are FOUR, not three**: `workspace-script-loader.ts:65`, `converter.ts:78`, `module-initializer.ts:340`, `application.ts:811`. The original row named only `application.ts:811-813` for the indexer and missed `module-initializer.ts:340`. Both indexer sites were switched to `loadAllToolsForPromptDetailed` by the skills-sync run on 2026-08-18, so the two are now consistent with each other — but nothing was consolidated and the hot-reload coupling below still stands. Original: **Three independent `ScriptToolDefinitionLoader` instances**, each parsing `tool.yaml` with its own in-memory cache: one in `PromptConverter`, one inside `WorkspaceScriptLoader` (`prompt-executor.ts:258-264`), one built ad hoc for the indexer (`application.ts:811-813`). Only the first is wired to file-level hot-reload invalidation (`runtime/script-hot-reload.ts`). The other two are correct **only because** full-refresh happens to rebuild them from scratch — an implicit coupling, not an enforced invariant. A future change that stops rebuilding on refresh silently serves stale tool definitions. | Skip the rebuild on one refresh path; assert a stale definition is served                                                                  | automation  |
| F9  | **SECURITY — script output is treated as trusted template source.** `processTemplate` deliberately escapes any **argument** whose value contains `{{`, `{%` or `{#` (`jsonUtils.ts:170-182` → `escapeJsonForNunjucks`, `:13-21`). Script stdout never reaches that control: it is spliced into the **template itself** (`script-reference-resolver.ts:151-154`, reached via `jsonUtils.ts:358`) and then rendered by Nunjucks at `:368` with `autoescape: false`. Not RCE — the environment exposes no globals — but it yields cross-argument disclosure into the rendered prompt, template-loop DoS, and structural prompt injection. Trigger: any script whose stdout carries content its author does not fully control (`github_scout` emits `json.dumps` of remote GitHub data). **Same shape as F1**: a safety control present on the declarative path and absent on the inline one.                                                                                                                                                                                                                                                                    | Reproduced 2026-08-18 against the real nunjucks build: arg path renders `{{ api_key }}` literally, spliced path renders the secret's value | automation  |
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
means the test is wrong, not the code. Both are currently unreachable from shipped resources —
measured 2026-08-18, zero prompts in this repo, the three sibling workspaces, or `~/.claude` use
`{{script:id}}` — so both fixtures must construct the reference themselves.

### Tier 3: The fix — reuse the existing port

| #   | St  | File                                     | Change                                                                                                                                                                                                                                                                                                                                                                                            | ~Lines | Depends  | Verify                           |
| --- | --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | -------------------------------- |
| 3.1 | ☐   | shared/ (new pure fn)                    | Promote `extractExplicitToolRequests` out of `ToolDetectionService` (`:140`, `private`) into a shared pure function. ONE encoding of the `tool:<id>` rule                                                                                                                                                                                                                                         | 15     | Q2 ruled | typecheck; detection tests green |
| 3.2 | ☐   | .../tool-detection-service.ts:95         | Call the shared function; delete the private copy                                                                                                                                                                                                                                                                                                                                                 | 5      | 3.1      | existing detection tests green   |
| 3.3 | ☐   | .../script-reference-resolver.ts:~218    | Guard before `scriptExecutor.execute`: if `tool.execution.confirm !== false` and the shared fn does not find `tool:<id>` in `context`, throw a confirmation-required error naming the opt-in. No port, no injection, no new state                                                                                                                                                                 | 25     | 3.2      | 2.2 flips GREEN                  |
| 3.4 | ☐   | .../script-reference-resolver.ts:151-154 | **F9**: wrap script output in `{% raw %}...{% endraw %}` before splicing into `resolvedTemplate`. NOT `escapeJsonForNunjucks` — measured 2026-08-18, that escape is half of an escape/unescape pair keyed to the arg it escaped, so on the splice path it leaves literal backslashes (`\{\{ api_key \}\}`) in the output. Raw-wrapping renders correctly. Handle output containing `{% endraw %}` | 8      | 2.3      | 2.3 flips GREEN                  |
| 3.5 | ☐   | ↑ test file                              | Approval path: same command WITH `tool:<id>` → executes                                                                                                                                                                                                                                                                                                                                           | 20     | 3.3      | green                            |

**Rows 3.1/3.2/3.4 of the pre-ruling plan are DELETED, not deferred.** They added a method to
`ToolTriggerFilterPort`, implemented it over the tracker, and threaded the concrete filter through
the composition root. Q2's measurement removed the need for all three: the resolver already holds
`args`. No new layer edge is created, so the `validate:arch` risk row below is now inapplicable.

**Tier 3 gate**: `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci` plus `npm run validate:arch`

### Tier 4: Independent defects (parallel-safe after Tier 1)

| #   | St  | File                   | Change                                                                                                                                                                                            | ~Lines | Depends  | Verify                                         |
| --- | --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | ---------------------------------------------- |
| 4.1 | ☐   | script-executor.ts:311 | `findRuntimeCommand` falls back when `commands[0]` absent                                                                                                                                         | 12     | 1.2      | test with missing first binary                 |
| 4.2 | ☐   | script-executor.ts:153 | Cap `truncateOutput`, AND return `success:false` naming the cap when truncation occurred — a truncated result cannot be field-accessed, so reporting it as a degraded success is a silent failure | 20     | Q3 ruled | test asserts BOTH the cap and the loud failure |

**Tier 4 gate**: `npm run test:ci`

### Tier 5: Record and document

| #   | St  | File                     | Change                                                        | ~Lines | Depends  | Verify            |
| --- | --- | ------------------------ | ------------------------------------------------------------- | ------ | -------- | ----------------- |
| 5.1 | ☐   | this file                | Keep ledger current as tiers land                             | —      | —        | prettier          |
| 5.2 | ✓   | -implementation-notes.md | Deviation log — created BEFORE Tier 1's first edit            | 25     | —        | exists before 1.1 |
| 5.3 | ☐   | ↑ notes                  | Falsification record: mutation + which test failed, per claim | 20     | 3.5, 4.1 | one row per claim |
| 5.4 | ☐   | CHANGELOG.md             | Fixed entry                                                   | 3      | 3.4      | commitlint        |

**Tier 5 gate**: `npm run validate:all`

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

| What to test                        | Test type   | Location                    | Why this type                                                          |
| ----------------------------------- | ----------- | --------------------------- | ---------------------------------------------------------------------- |
| Timeout, env allowlist, argv-safety | integration | script-subprocess.test.ts   | The claims are about a real OS process; a mock cannot exhibit SIGKILL  |
| Confirm parity across both paths    | integration | script-subprocess.test.ts   | The defect is a boundary difference between two callers of one service |
| Port method contract                | unit        | tool-trigger-filter.test.ts | Pure decision over injected state; extends the existing suite          |
| Runtime fallback (F4)               | unit        | script-executor.test.ts     | Single function, no I/O once the binary lookup is injectable           |

### Done criteria

| Criterion                      | Validation                                                                         | Pass condition                     |
| ------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------- |
| Bypass fixed                   | Tier 2.2 test                                                                      | RED before Tier 3, GREEN after     |
| Guard is observed              | revert 3.3, re-run                                                                 | exactly one named test fails       |
| No new layer edge              | `npm run validate:arch`                                                            | passes                             |
| No regression                  | `npm run validate:all`                                                             | passes                             |
| Real behavior, not green gates | `npm run build && npm run verify:mcp`, then drive a confirm-required tool via `>>` | blocks, then executes after re-run |

### Documentation

| Doc                                  | Update needed                                                   |
| ------------------------------------ | --------------------------------------------------------------- |
| CHANGELOG.md                         | Fixed entry (below)                                             |
| docs/reference/prompt-yaml-schema.md | State that `execution.confirm` applies to both invocation paths |
| docs/architecture/overview.md        | Only if the port gains a method worth naming in the stage map   |

### Risks

| Risk                                          | Impact                                                  | Mitigation                                                               | Rollback                   |
| --------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------- |
| Editing the shared port breaks Stage 08       | Script auto-execution stops                             | Additive method only; existing filter tests as canary                    | revert 3.1–3.2             |
| Confirm on inline refs breaks builder prompts | create_prompt/create_gate/create_framework stop working | They set `autoApproveOnValid: true` — verify that path explicitly in 3.5 | Q1 fallback: exempt inline |
| Real-subprocess tests flake in CI             | Red builds unrelated to the change                      | Node fixtures only; generous timeout margins                             | mark the file serial       |
| `process.ts` change leaks into shell-verify   | Gate verification breaks                                | process.ts is assertion-target-only, never edited                        | n/a — no edit to revert    |

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

**Fixed** — Inline `{{script:id}}` template references now honor a script tool's
`execution.confirm` setting. Previously only the declarative `tools:` path enforced confirmation,
so a tool declaring `confirm: true` executed unconditionally the moment a rendered template
referenced it; `confirm` defaults to true, so this affected every tool that had not explicitly
opted out. Both paths now resolve confirmation through the same `ToolTriggerFilterPort`, and
approval works the same way: re-run the command.
