---
title: "Per-Project Framework Selection"
date: 2026-08-01
status: done
tags: []
---

# Per-Project Framework Selection

**Date**: 2026-08-01
**Status**: Complete — all tiers landed
**Approach**: Both layers — `config.json` declares the per-project floor; a scoped runtime switch overrides it and persists per-workspace.

## Motivation

CAGEERF suits this repo; RADIANT suits Spicetify/design repos. Today the active framework is
a single global value shared by every project.

---

## F-Class Findings (measured 2026-08-01)

**F1 — `.mcp.json` pins the workspace to the plugin, not the project.**
`.mcp.json:11` sets `MCP_WORKSPACE=${CLAUDE_PLUGIN_ROOT}`. Every project resolves the same
workspace and the same `server/runtime-state/state.db`.

**F2 — `workspaceId` is never populated, so every scope collapses to `default`.**
It is sourced only from `identity.launchDefaults.workspaceId` or `--workspace-id`
(`runtime/options.ts:163`, `request-identity-resolver.ts:349`). `config.json` has no `identity`
section. Consequence: `SystemControlRouter.extractScope()` (`system-control-router.ts:345-350`)
returns `undefined` on every request, because it deliberately drops the `default` scope id.

**F3 — the framework switch path discards scope entirely.**
`FrameworkActionHandler.switchFramework()` (`framework-action-handler.ts:56`) calls
`frameworkManager.switchFramework(framework, reason)` with no `StateStoreOptions`.
`framework-action-handler.ts:82` likewise calls `getCurrentState()` unscoped, while siblings at
lines 268/309 _do_ pass `this.requestScope`. Inconsistent within one file.

**F4 — `getActiveFramework()` has no scope parameter at all.**
`framework-state-store.ts:332` calls `getOrCreateScopedState()` with no argument, always reading
the `default` in-memory bucket. This is the execution read path
(`prompt-executor.ts:667`, `context-builder.ts:159`).

**F5 — `FrameworkManager.defaultFramework` is dead config.**
Declared at `framework-manager.ts:51`, defaulted to `'CAGEERF'` at line 105, settable via
`FrameworkManagerConfig` — but no caller ever sets it. Both construction sites
(`mcp/tools/index.ts:427`, `framework-state-store.ts:176`) call `createFrameworkManager(logger)`
with no config. `config.json` has no `frameworks.defaultFramework` key.

**F6 — the persisted default is hardcoded a second time.**
`framework-state-store.ts:253` hardcodes `activeFramework: 'CAGEERF'` in the store's
`defaultState()`. This is a _separate_ hardcode from F5 — both must move to the configured value
or they will drift.

**Not broken**: the scope machinery itself. `kv_state` carries `workspace_id` columns,
`sqlite-store.ts:225 resolveScope()` and `framework-state-store.ts:150 getOrCreateScopedState()`
are implemented and correct. This is a wiring job, not a new subsystem.

---

## Structural Insight — one process per project

Claude Code launches a **separate MCP server process per project session**. Each process therefore
serves exactly one project for its whole lifetime.

This collapses the hard part of F4. Threading request scope through all ~10 `getActiveFramework()`
callers (`tool-description-loader.ts:229`, `gate-analyzer.ts:158`, `prompt-guidance/service.ts:370`,
`framework-discovery-processor.ts:18,58`, …) is unnecessary — several of those call sites have no
request context to thread. Instead, give `FrameworkStateStore` a **process-level default scope**
applied whenever no explicit scope is passed. One change replaces ten.

Rows in the shared `state.db` still separate correctly, because the scope columns key them by
workspace.

---

## Implementation

Paths in the Files column are repo-relative. All commands run inside `server/`.

### Tier 1 — Config floor

Make the per-project framework declarable in `config.json` and delivered to both places that
decide a default today (F5, F6).

| ID   | Status | Step                                                                                                                                                                           | Files                                                                                                                                                                                                                                                      | Depends | Verification                  |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------- |
| T1.1 | ✓      | Add `defaultFramework?: string` to `FrameworkSettings` (raw config shape) and `defaultFramework: string` to `ResolvedFrameworkConfig`                                          | `server/src/shared/types/core-config.ts`                                                                                                                                                                                                                   | —       | `npm run typecheck`           |
| T1.2 | ✓      | Add `frameworks.defaultFramework` (type string, default `"CAGEERF"`) to the JSON schema beside the existing `frameworks.*` keys                                                | `server/config.schema.json`                                                                                                                                                                                                                                | —       | `npm run validate:format`     |
| T1.3 | ✓      | Add to `DEFAULT_FRAMEWORKS_CONFIG`, return it from `getFrameworksConfig()`, and include it in the `!this.config.frameworks` backfill block                                     | `server/src/infra/config/index.ts`                                                                                                                                                                                                                         | T1.1    | `npm test -- config`          |
| T1.4 | ✓      | Pass `{ defaultFramework }` to `createFrameworkManager` at **both** construction sites; give `FrameworkStateStore` access to the resolved config so its own site can supply it | `server/src/mcp/tools/index.ts`, `server/src/engine/frameworks/framework-state-store.ts`                                                                                                                                                                   | T1.3    | `npm run typecheck`           |
| T1.5 | ✓      | Replace the hardcoded `'CAGEERF'` in the store's `defaultState()` with the configured default (F6)                                                                             | `server/src/engine/frameworks/framework-state-store.ts`                                                                                                                                                                                                    | T1.4    | `npm test -- framework-state` |
| T1.6 | ✓      | Route the four remaining fallback literals through `DEFAULT_FRAMEWORK_ID` — the fifth (`framework-action-handler.ts:83`) landed in T3.2                                        | `server/src/infra/observability/metrics/analytics-service.ts`, `server/src/engine/frameworks/prompt-guidance/service.ts`, `server/src/engine/execution/operators/chain-operator-executor.ts`, `server/src/mcp/tools/prompt-engine/utils/classification.ts` | T1.3    | `rg "'CAGEERF'" src/`         |

**Gate**: a `frameworks.defaultFramework` set in `config.json` is the framework a fresh state row
resolves to, via both construction sites; no literal `'CAGEERF'` default remains outside the single
config default constant.

**Gate result (2026-08-02, T1.6)**: clause 2 now **PASS**. Three fallback defaults route through
`DEFAULT_FRAMEWORK_ID` (`chain-operator-executor.ts` ×2, `analytics-service.ts`,
`prompt-guidance/service.ts`). Two of the four the plan listed were **misclassified and left
alone**: `classification.ts:190` returns `'CAGEERF'` from `suggestFramework()`, a keyword heuristic
whose sibling returns `'ReACT'` — it means "this content looks CAGEERF-shaped", not "use the
default", and routing it through the constant would silently change the suggestion if the default
were repointed. `llm-clients.ts:365` is fixture input for a connectivity self-test. Every remaining
literal is a `case` discriminator, a type comparison, `BUILTIN_FRAMEWORK_TYPES`, a doc example, or
the constant itself.

**Gate result (2026-08-01)**: clause 1 **PASS** — verified by
`framework-state-store.persistence.test.ts` ("a scope with no persisted row resolves to the
configured default framework"), typecheck, 1734 unit tests, `validate:all` exit 0, and
`verify:mcp` 11/11. Clause 2 **PARTIAL** — see Deviations.

### Deviations (Tier 1)

1. **Four literals, not two.** The plan named two (`framework-manager.ts:105`, store `:253`).
   Probing found four: `framework-manager.ts:105` and `:137`, plus **two** in the store —
   `createDefaultState()` (a `static` method, so it had no instance config and now takes the
   default as a parameter) and `loadPersistedState`. All four now route through a new
   `DEFAULT_FRAMEWORK_ID` constant.

2. **New file: `server/src/shared/utils/constants.ts`.** The gate demands a _single_ constant, but
   `infra` (L1) may not value-import from `engine` (L2) per `validate:arch`. The constant therefore
   lives at the shared layer (L0), which both may import.

3. **New file: `server/src/runtime/module-initializer.ts`** (not in T1.4's Files column). It owns
   the `createFrameworkStateStore` call, so it is where the resolved config value enters. The config
   read was also moved _above_ construction — the store seeds its in-memory default state in the
   constructor, so supplying the value afterwards would have left the seed on the fallback.

4. **Clause 2 overreached the tier's scope.** Five fallback literals remain, all outside Tier 1's
   declared Files column: `analytics-service.ts:99`, `prompt-guidance/service.ts:244`,
   `chain-operator-executor.ts:166,171`, `classification.ts:190`, and
   `framework-action-handler.ts:83` (which belongs to T3.2 and is folded in there). Tracked as
   **T1.6** rather than silently claimed — fixing them here would have been cross-tier batching.

5. **Test design corrected mid-tier.** The first version of the config-floor test used a second
   `mkdtemp` root and failed (`expected radiant, received react`). Cause: `SqliteEngine` is a
   process-wide singleton with no reset (`sqlite-engine.ts:60`), so the second root silently reused
   the suite's first database. Rewritten to assert on an unseen _scope_, which sidesteps the
   singleton. Worth knowing before writing the Tier 2 isolation tests.

### Tier 2 — Per-project scope identity

| ID   | Status | Step                                                                                                                                                                                                                        | Files                                                   | Depends | Verification                       |
| ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------- | ---------------------------------- |
| T2.1 | ✓      | Derive a project scope id — precedence `--workspace-id` / `identity.launchDefaults.workspaceId` → `CLAUDE_PROJECT_DIR` → `process.cwd()`; reduce to **basename** so raw paths stay out of logs and persisted state          | `server/src/runtime/options.ts`                         | T1 gate | unit test on precedence + basename |
| T2.2 | ✓      | Log the resolved scope id and which source produced it at startup                                                                                                                                                           | `server/src/runtime/application.ts`                     | T2.1    | `npm run verify:mcp`               |
| T2.3 | ✓      | Give `FrameworkStateStore` a process-level default scope used whenever `scope` is absent — covers `getOrCreateScopedState`, `loadPersistedState`, `saveStateToFile`. Resolves F4 without touching the ten read-path callers | `server/src/engine/frameworks/framework-state-store.ts` | T2.1    | `npm test -- framework-state`      |
| T2.4 | ✓      | On first scoped load with no row, seed from the existing unscoped `default` row when present, then write scoped — so upgrades do not appear to reset                                                                        | `server/src/engine/frameworks/framework-state-store.ts` | T2.3    | migration unit test                |

**Gate**: two different project directories resolve to two different scope ids; an existing global
`default` row is inherited once by the first project that loads, and neither project's later switch
is visible to the other.

**Gate result (2026-08-01)**: clauses 2 and 3 **PASS** — proven by
`framework-state-store.persistence.test.ts` ("two project scopes switch independently", "a new
project scope adopts the pre-scoping global row instead of resetting"). Clause 1 **PASS at the
function level, UNVERIFIED end-to-end** — see Deviations D4. Suite: typecheck clean, 1756 unit +
426 integration tests, ratchet 3451/1409 no regressions, `verify:mcp` 11/11, `validate:arch` and
five other guards pass.

### Deviations (Tier 2)

1. **`context.ts` joined T2.1's Files column.** The derivation could not live in
   `resolveRuntimeLaunchOptions`: an existing test (`options.identity.test.ts`, "does not hydrate
   from environment variables") asserts `identityDefaults` carries no `workspaceId`, and
   `applyRuntimeIdentityOverrides` spreads runtime defaults _over_ config — so deriving there would
   have silently outranked an operator's configured `identity.launchDefaults.workspaceId`. The pure
   derivation stays in `options.ts` (T2.1's file, unit-tested); the precedence is applied in
   `context.ts`, where config is known.

2. **Constructor converted to an options object.** `FrameworkStateStore` was already at 4
   parameters after Tier 1; `defaultScope` would have been a fifth, over the `max-params ≤4` hard
   limit. `FrameworkStateStoreOptions` also retires the `undefined` positional Tier 1 introduced.

3. **T2.4 kept small deliberately.** `framework-state-store.ts` was 681 lines against a 600 max
   before this tier. Answering the question project CLAUDE.md requires — _how many responsibilities?_
   — it holds four (scoped state map, SQLite persistence, switch history/metrics, health). Decomposing
   it is out of scope here, so `adoptLegacyGlobalState` is one focused method rather than a spread of
   inline logic. **The file is a decomposition candidate for a later tier.**

4. **The end-to-end discriminator is unproven.** `CLAUDE_PROJECT_DIR` is unset in this environment,
   so derivation falls to `process.cwd()`. Under `verify:mcp` that produced `server`, because the
   harness spawns from `server/`. Whether Claude Code's plugin launch supplies a per-project cwd (or
   sets `CLAUDE_PROJECT_DIR`) is **not verified from here** — if it supplies neither, every project
   derives the same id and no isolation occurs. The startup log line added in T2.2 exists precisely
   to make this checkable: restart in two projects and compare `Project scope id: … (source: …)`.
   Tracked as **T2.5**.

5. **`validate:format` failed on another session's file.** `plans/mcp-sdk-v2-spec-2026-07-28-migration.md`
   was being edited concurrently during this tier. Not touched; every Tier 2 file passes
   `prettier --check`.

| ID   | Status | Step                                                                                                                 | Files       | Depends | Verification                                           |
| ---- | ------ | -------------------------------------------------------------------------------------------------------------------- | ----------- | ------- | ------------------------------------------------------ |
| T2.5 | ✓      | Confirm the launcher supplies a per-project discriminator; if not, pass `--workspace-id` explicitly from `.mcp.json` | `.mcp.json` | T2 gate | Compare startup `Project scope id` across two projects |

**T2.5 result (2026-08-02) — CONFIRMED, no `.mcp.json` change needed.** Servers spawned from
`dist/` with two different working directories derived distinct ids and stayed isolated:

```
cwd=/home/minipuft/Applications/cloudySky           → Project scope id: cloudySky (source: cwd)
cwd=/home/minipuft/Applications/claude-prompts-mcp  → Project scope id: claude-prompts-mcp (source: cwd)
```

Switching cloudySky to RADIANT over MCP left this repo on CAGEERF, and both survived restart:

```
kv_state key='framework':  default → CAGEERF | cloudySky → radiant | claude-prompts-mcp → CAGEERF
```

`CLAUDE_PROJECT_DIR` is unset in this environment, so `cwd` is the operative rung. Still unverified:
whether the **plugin launcher** gives each project a distinct cwd — the evidence above is
direct-spawn. If a real restart shows two projects reporting the same id, pass `--workspace-id` in
`.mcp.json`.

**F7 — the load path ignored scope (found by this test, fixed 2026-08-02).**
`loadPersistedState` called `this.stateStore.load(scope)` with the raw argument. T2.3 applied
`effectiveScope` to `resolveStateKey` and `saveStateToFile` but **missed the load call**, so every
startup read the global `default` row while switches wrote the project's row. Live evidence:
`cloudySky → radiant` sat in `kv_state` while the server reported CAGEERF.

Fixing that exposed a second defect: `SqliteStateStore.load()` synthesizes a valid-looking default
when no row exists, so it cannot distinguish "never written" from "written". The load is now gated
on `exists()`, without which T2.4's adoption could never fire.

**Both defects were invisible to the unit tests**, which asserted through `getCurrentState(scope)` —
the in-memory map — and never round-tripped a process-default scope through SQLite across two store
instances. The T2.4 adoption test had been passing for the wrong reason: the always-read-`default`
bug returned the legacy row regardless. Covered now by "a process-scoped switch survives a restart
of that project" in `workspace-continuity.test.ts`.

### Tier 3 — Switch path

| ID   | Status | Step                                                                                                                                 | Files                                                                      | Depends | Verification        |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------- | ------------------- |
| T3.1 | ✓      | Thread `StateStoreOptions` through `FrameworkManager.switchFramework` → `FrameworkStateStore.switchFramework`                        | `server/src/engine/frameworks/framework-manager.ts`                        | T2 gate | `npm run typecheck` |
| T3.2 | ✓      | Pass `this.requestScope` at the switch call and change the unscoped `getCurrentState()` to `getCurrentState(this.requestScope)` (F3) | `server/src/mcp/tools/system-control/handlers/framework-action-handler.ts` | T3.1    | integration test    |

**Gate**: a `system_control framework:switch` persists to the calling project's scoped row only.

**Gate result (2026-08-02)**: **PASS**, with the scope-source correction in D3 below. Proven by
`framework-action.test.ts` ("delegates framework switch through framework manager", now asserting
the scope argument) and `workspace-continuity.test.ts` ("a scoped FrameworkManager switch persists
to that workspace only"). typecheck exit 0, ratchet 3442/1406 no regressions, 15 suites / 131 tests
across every suite this plan touches.

### Deviations (Tier 3)

1. **`FrameworkStateAccessor` had to widen too.** `framework-manager.ts:41` declares the narrowing
   interface FrameworkManager holds the store through, and its `switchFramework(request)` had no
   scope parameter — so threading scope would not have typechecked without changing it.

2. **A pre-existing test asserted the defect.** `framework-action.test.ts` (from `913c2d9d`)
   asserted `switchFramework` receives exactly two arguments. Updated to assert the scope argument
   explicitly, turning it into an F3 regression test. Its sibling case is still named "reads state
   store without identity-scoped args" — that name is now stale, but the assertion passes because
   `system-control-router.ts:149` independently calls `getCurrentState()` unscoped, and
   `toHaveBeenCalledWith` matches any call.

3. **Tier 3 does not deliver STDIO per-project scoping — Tier 2 does.** `extractScope` calls
   `resolveRequestIdentity`, which reads identity only from token claims and request headers
   (`x-workspace-id`, `x-org-id`, …) and **never consults `identity.launchDefaults`**. Under STDIO
   there are no headers, so `this.requestScope` is `undefined` on every request and the write falls
   through to the store's process-level `defaultScope` from T2.3. Tier 3's value is the HTTP /
   multi-client path, where an explicit per-request scope now stops one workspace's switch from
   overwriting another's. The test proves it by supplying a real `x-workspace-id` header.

4. **`npm test` does not pass tree-wide, for unrelated reasons.** Five failures in "Consolidated MCP
   tool factories" and "PromptEngine Validation" come from `PromptExecutor requires serverRoot`
   thrown at `prompt-executor.ts:148` — a guard a concurrent session added while this tier ran, in
   files this tier never touched. Typecheck also failed transiently mid-edit on their
   `pipeline-builder.ts` and recovered on its own.

### Tier 4 — Validation & docs

| ID   | Status | Step                                                                                                                                  | Files                                                        | Depends | Verification              |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------- | ------------------------- |
| T4.1 | ✓      | Isolation test: two scopes switch independently; an unset workspace inherits the config floor rather than the other workspace's value | `server/tests/`                                              | T3 gate | `npm run test:ci`         |
| T4.2 | ✓      | Document the real scope source and the per-project framework workflow                                                                 | `docs/guides/identity-scope.md`, `docs/guides/frameworks.md` | T3 gate | `npm run validate:format` |
| T4.3 | ✓      | Note in the Runtime State table that `kv_state key='framework'` is workspace-scoped                                                   | `CLAUDE.md`                                                  | T3 gate | `npm run validate:format` |

**Gate**: `npm run typecheck && npm run lint:ratchet && npm run test:ci` and `npm run validate:all`
pass; `npm run verify:mcp` answers on all three tools.

**Gate result (2026-08-02)**: `typecheck` **exit 0** · `lint:ratchet` **exit 0** (3442/1406, no
regressions) · `test:ci` **exit 0** (146 suites, 1756 tests) · `verify:mcp` **11/11** ·
`validate:all` **exit 123 — blocked on a file this plan does not own** (see D3).

### Deviations (Tier 4)

1. **`gates.md` was the wrong doc.** That guide covers gate criteria and enforcement modes; it has
   no framework-selection content. The per-project workflow went to `docs/guides/frameworks.md`,
   beside its existing "Switch the Active Framework" section, with a cross-link to the scope
   resolution order in `identity-scope.md`.

2. **A stale count in `identity-scope.md` was corrected.** It promised "14 tests passing" for the
   tenant suite; the actual figure was 15 before this tier and 16 after. Caught by running the
   suite rather than trusting the doc — the kind of drift the docs/code lockstep rule exists for.

3. **`validate:all` cannot pass from here.** Its `validate:format` step fails on
   `plans/mcp-sdk-v2-spec-2026-07-28-migration.md`, a file a concurrent session has been editing
   throughout this work. Every file this plan touches passes `prettier --check`. Formatting theirs
   while they hold it open risks losing their edits, so it is left alone — **whoever commits that
   file must format it first, or CI's `validate:format` will fail.**

---

## Risks

| Risk                                              | Mitigation                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `CLAUDE_PROJECT_DIR` not set under some launchers | Explicit precedence chain ends at `process.cwd()`; log the resolved source at startup       |
| Existing global `default` row silently orphaned   | On first scoped load with no row, seed from the `default` row if present, then write scoped |
| Raw filesystem paths as scope ids leak into logs  | Hash or basename the derived id; keep the raw path out of persisted state                   |
| Two hardcoded defaults (F5, F6) drift again       | Both fixed in the same change; test asserts they agree                                      |

## Out of Scope

- Retiring `chain_run_registry` (tracked separately, post-Tier-10)
- Per-project gate enable/disable (same mechanism would apply; not requested)
