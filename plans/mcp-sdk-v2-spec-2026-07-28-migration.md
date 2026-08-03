---
title: "MCP SDK v2 + Spec 2026-07-28 Migration"
date: 2026-08-01
status: active
tags: []
---

# MCP SDK v2 + Spec 2026-07-28 Migration

**Status**: **Tier B COMPLETE** (2026-08-02) — B0-B10 all landed. Tiers A and A2 complete. Both protocol eras are served on both transports, guarded by e2e fixtures. Next: Tier C (dynamic tool-schema reconfiguration), which depended on B7.
**Created**: 2026-08-01
**Work type**: feature (secondary: refactor) · **Risk**: high · **Confidence**: high

---

## Decisions (settled 2026-08-01)

**D1 → DELETE SSE in Tier B.** **D2 → contract = union of all reachable shapes.** Both recommendations confirmed by the operator. The reasoning that produced them is retained below for the record; neither is open.

### D1 — SSE disposition — DECIDED: delete

SDK v2 **deletes** `SSEServerTransport`. The spec grants HTTP+SSE a 12-month deprecation window, so the protocol permits keeping it — but the TypeScript SDK no longer ships the class, so keeping it means hand-maintaining a transport upstream removed.

| Option                                | Cost                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Delete in Stage B** _(recommended)_ | 24 doc references to reconcile; `--transport=both` loses meaning; any legacy HTTP consumer breaks                             |
| Keep, hand-maintained                 | A permanent parallel path with no retirement trigger — precisely what `cleanup-standards.md` §"Parity Gates Are Debt" forbids |

Recommendation: **delete**. The repo already publishes SSE as deprecated (`docs/portfolio/design-decisions.md:35`, `docs/reference/mcp-tools.md:1008`), so removal executes a stated position rather than reversing one. It also removes the file's worst complexity hotspot (`transport/index.ts:173` — cognitive 21, cyclomatic 16, nesting 5) at zero extra cost.

This contradicts `CLAUDE.md` Core Principle 3 (_"Transport Parity — Runtime changes must work in STDIO and SSE"_), which must be rewritten to STDIO + Streamable HTTP either way, since SSE is deprecated in both readings.

### D2 — Semver ruling for a dynamic parameter surface — DECIDED: union

`CLAUDE.md` §Public API Contract places MCP tool parameters inside the contract, break ⇒ major. Once the surface varies by framework state, "break" needs a definition.

| Option                                                       | Consequence                                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **Contract = union of all reachable shapes** _(recommended)_ | A framework switch narrows within a declared surface. Only adding/removing a parameter from the union is major. |
| Contract = shape at current state                            | Every framework switch is a breaking change; the major version stops carrying information.                      |

Recommendation: **union**. Record the ruling in `CLAUDE.md` as part of Stage C7.

---

## Why now

MCP spec revision **2026-07-28** (published 2026-07-28) is the largest since launch: it removes protocol-level sessions, the `initialize` handshake, `ping`, `logging/setLevel`, and SSE resumability; adds `server/discover`, `subscriptions/listen`, MRTR, and cacheable list results.

TypeScript SDK **v2.0.0** (published 2026-07-27) splits the monolith into scoped packages and is the only line that speaks the revision. This repo runs `@modelcontextprotocol/sdk@1.30.0` — the terminal v1 release, whose `LATEST_PROTOCOL_VERSION` is `2025-11-25`.

Not urgent: v1 keeps working, field clients still negotiate `2025-11-25`, and deprecations carry a 12-month window. Worth planning now because three v2 prerequisites already landed in PR #172 (node ≥22, zod ^4.4.3, `registerTool`), which materially lowers Stage A.

## What survives untouched

Chain execution state (`chain_run_registry`, `chain_sessions`) is **app-level**, keyed by the repo's own run IDs — not MCP protocol sessions. That is exactly the pattern the new spec prescribes: _"servers that need cross-call state use explicit, server-minted handles passed as ordinary tool arguments."_ The stateless move does not threaten chains.

Roots, Sampling, and `logging/setLevel` — the three newly-deprecated features — are unused (`rg` clean).

---

## The capability unlock (Stage C)

`mcp/tools/index.ts:883-885` claims:

> _"The MCP SDK does not support re-registering already registered tools."_

This is **stale**. `RegisteredTool.update({ description, paramsSchema, outputSchema, annotations, callback, enabled })` exists in v1 and survives in v2 (`createMcpHandler-dBHMsxwf.d.cts:3487`), gaining `name` and `remove()`. The **parameter surface itself is mutable**, not just description text — which is why `buildPromptEngineSchema` is called exactly once, at registration (`index.ts:580`).

So a framework or gate state change can reshape which parameters `prompt_engine` exposes, requires, or enum-constrains. That moves gate enforcement from prose in a description (advisory — the client can still construct an invalid call) to schema shape (structural — it cannot).

### The constraint that shapes the design

`createMcpHandler` calls the factory **once per HTTP request** (`d.cts:3769-3776`). Therefore `update()` mutations **do not survive the request that made them**. A mutation-only design would pass its STDIO test and silently no-op over HTTP.

Resolution — make the schema a **pure function of state**, evaluated at construction:

| Path  | Mechanism                                                                        |
| ----- | -------------------------------------------------------------------------------- |
| HTTP  | factory reads current state → every request gets the current shape. No mutation. |
| STDIO | instance outlives the switch → `update({ paramsSchema })` reshapes in place.     |
| Both  | `handler.notify.toolsChanged()` tells opted-in subscribers to re-list.           |

`serveStdio(factory: McpServerFactory, …)` (`stdio.d.cts:61`) takes the **identical factory type** `createMcpHandler` takes — "one factory, two entries" is the SDK's own contract, not an inference.

---

## Plan

### Tier A — type-visibility restoration ✓ COMPLETE (2026-08-01)

Executed. Gate passed. Scope was **wider than planned** and the tier **stopped short of A1-A4** for a reason discovered during execution (§"Why A1-A4 moved", below).

| #   | Status | File                                                                                                                                        | Change                                                                                                                                                                                                                                                    | Verify result                                                                                                            |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A0a | ✓      | `src/mcp/tools/index.ts:97,138,996`                                                                                                         | Type `mcpServer: any` → `McpServer` — **three sites, not one**: the class field (`:97`, the root cause), the constructor param (`:138`), and the factory param (`:996`). Added `McpServer` + `Implementation` imports.                                    | 7 unsafe-call/unsafe-member-access reports at `:757`, `:814`, `:899`, `:900` cleared                                     |
| A0b | ✓      | `src/mcp/tools/index.ts:81-88`                                                                                                              | Replaced the string-indexed cast in `readClientVersion` with a typed call returning `Implementation \| undefined`; simplified `getDetectedClientInfo` (`:310`) whose defensive `as Record<string, unknown>` casts became redundant                        | `tsc --noEmit` green; the handshake path is now compiler-visible                                                         |
| A0c | ✓      | `src/mcp/tools/index.ts:1021-1022`                                                                                                          | No change required — `McpToolRouter as McpToolsManager` and `createMcpToolsManager = createMcpToolRouter` inherit the now-typed symbols by construction                                                                                                   | `tsc --noEmit` green                                                                                                     |
| A0d | ✓      | `src/infra/http/transport/index.ts:36,44`                                                                                                   | **Not in the original plan.** A _fourth_ `mcpServer: any` — found because it is what concealed the transport/server coupling that blocks A1. Typed to `McpServer`.                                                                                        | `tsc` now reports `'SSEServerTransport' is deprecated` at `:10`, `:39`, `:146` — three warnings the `any` had suppressed |
| A0e | ✓      | `transport/index.ts:410` · `system-control-router.ts:88,386` · `prompt-executor.ts:87,134,727` · `resource-manager/prompt/core/types.ts:56` | **Also not in the plan, and the reason Tier A was nearly declared done prematurely.** A sweep (`rg "mcpServer[?]?\s*:\s*any"`) found **seven more** untyped sites across four files — the first two commits had covered 2 of 9. All typed to `McpServer`. | Sweep returns zero; all 16 seams now `McpServer`                                                                         |

**Dead seams recorded during A0e** — typed for consistency, but carrying no live value. A separate cleanup, not migration work:

| Site                                       | Finding                                                                                                                                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt-executor.ts:87`                    | Assigned at `:144`, never read. `tsc` confirms: _"'mcpServer' is declared but its value is never read"_ — along with three siblings (`semanticAnalyzer`, `conversationStore`, `textReferenceStore`) |
| `system-control-router.ts:88`              | `_mcpServer` is discarded by the constructor; threaded in from `:386` for nothing                                                                                                                   |
| `resource-manager/prompt/core/types.ts:56` | `PromptResourceDependencies.mcpServer` is neither set by any caller nor read by any consumer                                                                                                        |

Removal was considered and deferred: it changes three factory/constructor signatures whose 6+ test call sites pass positional `mockMcpServer as any`. That is a signature change — a different class of work than Tier A's annotations — and bundling it would have cost the tier its attributability.

**Tier A gate — PASSED**

| Check                        | Result                                              |
| ---------------------------- | --------------------------------------------------- |
| `npm run typecheck`          | green                                               |
| `npm run lint:ratchet`       | **improved** — 3470→3467 errors, 1418→1411 warnings |
| `npm run build`              | green                                               |
| `npm run verify:mcp`         | 11/11 checks passed                                 |
| `npm run test:ci`            | 146 suites, 1732 tests, all passed                  |
| `npm run validate:arch`      | 0 errors (2 pre-existing warnings, unrelated)       |
| `npm run validate:contracts` | green                                               |

> **The A0-before-A2 ordering was correct, and paid off immediately.** Typing the seams did not merely enable a later check — it surfaced the A1 blocker below, which the `any` had been hiding.

### Tier A2 — dead wiring removal (inserted 2026-08-02, before Tier B)

**Why before Tier B, not after.** Tier B builds `createMcpHandler(factory)`, where the factory constructs a fresh `McpServer` **per HTTP request** and wires it into the subsystems. Dead constructor parameters would mean threading a live per-request server through wiring nobody reads — inflating the apparent integration surface at exactly the moment it needs to be understood precisely. Cleaning first also touches these constructors once instead of twice.

**Scope discipline.** A `tsc --noUnusedLocals --noUnusedParameters` sweep found **84 dead symbols repo-wide**; only **13** sit on the SDK-seam path. This tier takes the 13. The other 71 are a separate sweep — and are deliberately not touched now, because most live in `engine/frameworks/*` and `engine/execution/*` where a concurrent session is actively editing.

Field-vs-parameter liveness was verified per symbol rather than assumed — they are not equivalent:

| Symbol                                 | Field | Param                                                              | Action                                  |
| -------------------------------------- | ----- | ------------------------------------------------------------------ | --------------------------------------- |
| `prompt-executor` `mcpServer`          | dead  | dead                                                               | remove both + factory param + call site |
| `prompt-executor` `conversationStore`  | dead  | dead                                                               | remove both + factory param + call site |
| `prompt-executor` `semanticAnalyzer`   | dead  | **live** — `:152` `new ExecutionPlanner(semanticAnalyzer, logger)` | remove field only                       |
| `prompt-executor` `textReferenceStore` | dead  | **live** — `:184`                                                  | remove field only                       |

Removing all four parameters would have broken `ExecutionPlanner` construction.

| #   | Site                                                            | Change                                                                                                       | Signature change? |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------- |
| A2a | `mcp/tools/index.ts:19,74,133-135`                              | Drop unused imports `path`, `ToolResponse`; drop dead fields `promptsData`, `convertedPrompts`, `categories` | no                |
| A2b | `runtime/application.ts:44,61,353`                              | Drop unused import `notifyResourcesChanged`; drop write-only field `toolDescriptionLoader`                   | no                |
| A2c | `prompt-executor.ts:90-92,147,149,190`                          | Drop write-only fields `semanticAnalyzer`, `textReferenceStore`; drop local `gatesDirectory`                 | no                |
| A2d | `resource-manager/prompt/core/types.ts:56`                      | Drop `PromptResourceDependencies.mcpServer` — never set, never read                                          | no                |
| A2e | `prompt-executor.ts:87,133,144,726,738` · `:91,137,148,730,742` | Drop fully dead `mcpServer` and `conversationStore` (field + ctor param + factory param + call site)         | **yes**           |
| A2f | `system-control-router.ts:88,386,387`                           | Drop discarded `_mcpServer` param                                                                            | **yes**           |

**Excluded deliberately**: `transport/index.ts` `configManager` (`:36,44,49,409,413`) is dead through the whole chain, but Tier B rewrites that file wholesale — cleaning it now is churn Tier B overwrites.

**Gate — PASSED (2026-08-02)**: typecheck green · test:ci **146 suites / 1756 tests, all pass** · lint:ratchet **3451→3442 errors, 1409→1406 warnings** · build green · verify:mcp 11/11 · targeted sweep returns empty (all 13 resolved) · repo-wide dead symbols **84 → 72**.

**A cascade the plan did not predict.** Removing `PromptExecutor`'s dead `conversationStore` parameter made `McpToolRouter.conversationStore` dead in turn, which made it dead in `ModuleInitParams`, which made `application.ts` stop passing it. Four files, followed to its natural end rather than left half-done. The chain stopped on evidence, not fatigue: `ConversationStore` is still live in five other files (`application.ts` ×11, `prompts/registry.ts` ×9, `prompts/index.ts` ×6, `converter.ts` ×1), so the service itself stays — only this one wiring branch was dead.

**Test call sites updated**: 5 system-control action tests (uniform `{ sendNotification: jest.fn() } as any` argument removed), `consolidated-tools.test.ts`, `prompt-engine-validation.test.ts`, plus the mock fixtures those removals orphaned (`mockMcpServer`, `mockConversationStore`).

**Config hole closed (2026-08-02), cleanup deferred** — see §Deferred Tiers D1/D2. The original note follows.

**Found**: `npm run typecheck:tests` is structurally broken — `tsconfig.test.json` includes `tests/**/*` while `rootDir` is `src`, so every test file errors `TS6059`. That is why `prompt-engine-validation.test.ts` carries type errors (`ConfigManager` not exported, `never` argument mismatches) that nothing catches. Pre-existing and unrelated to this tier; worth its own fix, since it means the test suite has no type gate at all.

### Deferred Tiers — surfaced by this work, deliberately not bundled

Both were found while executing Tier A2. Neither belongs in the SDK migration: bundling either would cost the migration tiers their attributability, and both are large enough to deserve their own gate.

#### D1 — Remaining dead symbols (72)

A `tsc --noUnusedLocals --noUnusedParameters` sweep found **84** dead symbols repo-wide. Tier A2 removed the **12** on the SDK-seam path (84 → 72 measured after). The remaining 72 are concentrated in:

| Area                  | Approx. count | Note                                                                                                 |
| --------------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| `engine/frameworks/*` | ~20           | `framework-semantic-integration.ts`, `generic-framework-guide.ts`, `template-enhancer.ts`            |
| `engine/execution/*`  | ~15           | `execution-planner.ts`, `argument-parser.ts`, `context-resolver.ts`, `injection-decision-service.ts` |
| `engine/gates/*`      | ~5            | `temporary-gate-registry.ts`, `gate-provider-adapter.ts`, `semantic-gate-service.ts`                 |
| remainder             | ~32           | `infra/*`, `mcp/http/api.ts`, misc                                                                   |

**Do not start this during Tier B.** A concurrent session has been editing `engine/frameworks/*` and `engine/execution/pipeline/*` throughout 2026-08-01/02; a sweep there would collide. Re-measure the count before executing — it will have drifted.

**Method that worked in A2, reuse it**: verify field-vs-parameter liveness per symbol rather than trusting the sweep. In A2, two of four symbols had dead fields but _live_ parameters; removing both would have broken `ExecutionPlanner` construction. Also expect cascades — one removal made three upstream layers dead in turn.

#### D2 — Test-suite type errors (865)

`tsconfig.test.json` extended a base config pinning `rootDir` to `./src` while itself including `tests/**/*`, so every test file failed `TS6059` before any real checking began. `npm run typecheck:tests` reported nothing but config noise, and — critically — **the script is referenced nowhere**: not in `validate:all`, not in `.husky/*`, not in CI. That is how it stayed broken. The test suite has had no type gate at all.

**Fixed now** (one line, zero risk since no gate runs it): `rootDir: "."` override in `tsconfig.test.json`, with a comment explaining why. TS6059 count is now 0, so the script measures something real.

**Deferred**: the 865 errors it now reports.

| Code      | Count | Meaning                                                             |
| --------- | ----- | ------------------------------------------------------------------- |
| TS2532    | 315   | Object possibly `undefined` — strict null checks against test mocks |
| TS4111    | 145   | Index-signature property needs `obj['key']` access                  |
| TS2345    | 99    | Argument type mismatch                                              |
| TS2322    | 57    | Assignment type mismatch                                            |
| TS2339    | 50    | Property does not exist                                             |
| TS2353    | 43    | Unknown object-literal property                                     |
| remainder | 156   | TS2305, TS2554, TS7006, TS2459, …                                   |

**Do not wire `typecheck:tests` into `validate:all` until this reaches zero** — CI runs `validate:all` whole, so adding it now turns CI red. The repo already has the right pattern for driving a number down under enforcement: `scripts/eslint-ratchet.js`. A parallel ratchet is likely the cheaper path than an 865-error cleanup, and would let the gate be enforced immediately at its current baseline.

### Why A1-A4 moved to Tier B

The plan assumed the codemod could run standalone against a v1→v2 package swap. Execution disproved that. Measured facts:

- The SDK import surface is **14 files, 5 import paths** — smaller than feared.
- **No test file imports the SDK** (`tests/e2e/helpers/http-mcp-client.ts` hand-rolls JSON-RPC over `node:http`). So `@modelcontextprotocol/client@2.0.0` is **not** needed. A1's open question is resolved: ~~three packages, not four~~ — **corrected 2026-08-02 by direct measurement: two packages.** See §B0.
- v2 has **no `SSEServerTransport`** (expected) **and no `StreamableHTTPServerTransport`** (not anticipated) — it offers `PerRequestHTTPServerTransport` and `WebStandardStreamableHTTPServerTransport` instead.
- `transport/index.ts:90,158` calls `this.mcpServer.connect(transport)` on the **same instance** `application.ts` constructs. Server and transports must therefore come from the same SDK major.

**Consequence**: v1/v2 coexistence — which the migration guide otherwise blesses for staged migrations — is **not viable here**. Swapping the package forces the transport rewrite, which forces both the SSE deletion (D1) and `createMcpHandler`/`serveStdio` adoption. A1-A4 are atomic with B1-B5.

**Restructure**: A1-A4 fold into Tier B as its opening steps. Tier A stands as the type-visibility tier — small, verified, independently revertable, and the thing that made the coupling visible. 13 of 14 files still migrate mechanically; only `transport/index.ts` needs design work, and it needed it anyway.

**Knock-on for B9**: since the e2e helper is hand-rolled JSON-RPC rather than an SDK client, adding a second protocol era means hand-writing the 2026-07-28 `_meta` envelope, not swapping a client class. B9 was already flagged as the least grounded estimate in the plan; this raises it further.

### Tier B — spec 2026-07-28 support

#### B0 — the package swap (added 2026-08-02; the table below could not execute without it)

**A plan defect, found at Tier B ingestion.** §"Why A1-A4 moved to Tier B" states that A1-A4 "fold into Tier B as its opening steps" and are "atomic with B1-B5" — but the table started at B1, which constructs an `McpServerFactory`, a **v2-only type**. No row installed the packages or rewrote the imports. As tabulated, Tier B's first step could not compile. B0 below is that missing work, now scoped against measurement rather than estimate.

Probed 2026-08-02 by installing `@modelcontextprotocol/{core,server,node}@2.0.0` into a scratch tree and grepping the shipped `.d.cts` files — the same "declarations are the authority" move that resolved the earlier unknowns.

**Two direct packages, not three.** `@modelcontextprotocol/server` declares `dependencies: {"zod":"^4.2.0","@modelcontextprotocol/core":"2.0.0"}`, and no file in this repo imports from `core` directly. `core` therefore arrives transitively and does not belong in `package.json`. `@modelcontextprotocol/node` is needed only for `toNodeHandler` (it pulls `@hono/node-server`).

**Five v1 subpaths collapse to three v2 specifiers** — every symbol this repo imports survives, at a new address:

| v1 import (uses)                   | Symbols                                                          | v2 home                                       |
| ---------------------------------- | ---------------------------------------------------------------- | --------------------------------------------- |
| `sdk/server/mcp.js` (17)           | `McpServer` ×13, `ResourceTemplate` ×4                           | `@modelcontextprotocol/server`                |
| `sdk/types.js` (6)                 | `ReadResourceResult` ×4, `isInitializeRequest`, `Implementation` | `@modelcontextprotocol/server`                |
| `sdk/server/stdio.js` (1)          | `StdioServerTransport`                                           | `@modelcontextprotocol/server/stdio`          |
| `sdk/server/streamableHttp.js` (1) | `StreamableHTTPServerTransport`                                  | **removed** → `PerRequestHTTPServerTransport` |
| `sdk/server/sse.js` (1)            | `SSEServerTransport`                                             | **removed** → deleted per D1                  |

So 14 of 16 files migrate by rewriting a specifier string; only `transport/index.ts` and `startup-server.ts` change shape.

**Machinery for B2/B6 confirmed present** (all exported from `@modelcontextprotocol/server`): `createMcpHandler`, `McpServerFactory` (`:3810`), `serveStdio`, `PerRequestHTTPServerTransport`, `WebStandardStreamableHTTPServerTransport`, `RegisteredTool` (`:3463`, with `update()`), plus the dual-era set `legacyStatelessFallback` · `classifyInboundRequest` · `isLegacyRequest` · `ProtocolEra` · `SUPPORTED_PROTOCOL_VERSIONS`, and the B6 identity set `RequestMetaEnvelope` · `CLIENT_INFO_META_KEY` · `CLIENT_CAPABILITIES_META_KEY` · `PROTOCOL_VERSION_META_KEY`.

`legacy?: 'stateless' | 'reject'` verified at `createMcpHandler-dBHMsxwf.d.cts:3854` — the plan's `legacy: 'stateless'` is the real option name and value.

#### Tier B readiness — NOT MET as of 2026-08-02

Tier B is the plan's highest-risk tier (a breaking transport rewrite, ~−210 lines, `feat(runtime)!`). Three conditions block a responsible start. None are about the migration being wrong; all are about the tree it would land on.

| Blocker                                                                                                                                                                                                                                                                                                                            | Evidence                                            | What clears it                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nothing is committed.** Tiers A + A2 sit uncommitted on `main` alongside a second session's work — 43 modified files, interleaved.                                                                                                                                                                                               | `git status --short`                                | Commit Tiers A + A2. The plan's own rollback for B3 reads "restore from the B3 commit; it is a single deletion commit by design" — that rollback does not exist without a commit boundary beneath it. |
| **B6 rewrites a subsystem another session is mid-edit on.** B6 replaces `getClientVersion()` with the `_meta` envelope; the concurrent session has +234 uncommitted lines across `runtime/context.ts`, `runtime/options.ts`, both identity test files, and `docs/guides/identity-scope.md`.                                        | `git diff --stat` on those paths                    | Their identity work lands, or B6 defers to a follow-up tier.                                                                                                                                          |
| **B0 deletes a dependency another session is writing policy for.** `.github/renovate.json5` is +149/−75 uncommitted and contains `matchPackageNames: ["@modelcontextprotocol/sdk"]` / `groupName: "MCP SDK"` at `:112-116`; their acceptance criterion 8 names "MCP SDK" in the automerge exclusion list. B0 removes that package. | `rg -n modelcontextprotocol .github/renovate.json5` | Coordinate: their rule must name the two scoped packages instead. Cheap if done together, a silent policy hole if not.                                                                                |

**Baseline is otherwise healthy**: `npm run typecheck` green at ingestion.

| #     | File                                                               | Change                                                                                                                                          | ~Lines    | Depends | Verify                                                         |
| ----- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------- | -------------------------------------------------------------- |
| ✓ B0  | `package.json`, 16 files across `src/` + 2 in `scripts/`           | Swap `@modelcontextprotocol/sdk@^1.25.2` → `@modelcontextprotocol/server@2.0.0` + `node@2.0.0`; rewrite 5 subpaths → 3 specifiers (table above) | ~16 files | A gate  | `rg '@modelcontextprotocol/sdk'` → empty; `tsc --noEmit` green |
| ✓ B1  | `src/runtime/application.ts:235-265`                               | Extract `McpServerFactory` closure over existing singletons                                                                                     | ~60       | **B0**  | factory returns a working `McpServer`                          |
| ✓ B2  | `src/infra/http/transport/index.ts`                                | `createMcpHandler(factory, { legacy: 'stateless' })` + `toNodeHandler` into Express                                                             | ~80       | B1      | dual-era smoke test                                            |
| ✓ B3  | `src/infra/http/transport/index.ts:9,38,145-234,**372,386-387**`   | **Delete SSE** (pending D1)                                                                                                                     | −150      | B2, D1  | `rg 'sseTransports'` → empty                                   |
| ✓ B4  | `src/infra/http/transport/index.ts:39,252-296,**274**,392`         | Delete session registry + `sessionIdGenerator`                                                                                                  | −60       | B2      | `rg 'sessionIdGenerator'` → empty                              |
| ✓ B5  | `src/runtime/startup-server.ts`                                    | `serveStdio(factory)`                                                                                                                           | ~20       | B1      | `verify:mcp` on stdio                                          |
| ✓ B6  | `src/mcp/tools/index.ts:86,305-339`                                | Identity: `getClientVersion()` → `ctx.mcpReq.envelope`                                                                                          | ~40       | B1, A0b | `request-identity-resolver` + `identity-policy-boundary` pass  |
| ✓ B7  | `src/mcp/tools/index.ts:899`, `src/modules/resources/index.ts:131` | `sendToolListChanged`/`sendResourceListChanged` → `handler.notify.toolsChanged()`/`.resourcesChanged()`                                         | ~25       | B2      | subscriber receives event                                      |
| ✓ B8  | `src/runtime/application.ts:241-244`                               | `capabilities` block → `server/discover`                                                                                                        | ~15       | B1      | discover advertises all three surfaces                         |
| ✓ B9  | `tests/e2e/helpers/http-mcp-client.ts`                             | Dual-protocol fixture                                                                                                                           | ~120      | B2      | drives both revisions against one build                        |
| ✓ B10 | —                                                                  | Cache posture: keep `tools/list` at `ttlMs: 0` (SDK default), recorded as a deliberate choice                                                   | doc       | B2      | stated in this file                                            |

**Tier B gate**: a `2026-07-28` client and a `2025-11-25` client both complete a chain run against one build.

#### Tier B execution record (2026-08-02)

**Gate: MET.** Both protocol eras drive tools against one build, verified against a running server:

| Era                 | Evidence                                                                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2024-11-05 (legacy) | `npm run verify:mcp` — 11/11, full flow through `initialize` → `tools/list` → three `tools/call`s, served by the stateless fallback                                                           |
| 2026-07-28 (modern) | `tools/list` → 3 tools, `server/discover` → all three capabilities, `tools/call` on `system_control` and `prompt_engine` (117 prompts) — **no `initialize` handshake**, `_meta` envelope only |

**What the probe taught that the plan did not predict.** The modern era rejects a request whose headers and body disagree, and the required headers are not in the plan: `Mcp-Method` on every call and `Mcp-Name` on `tools/call`, alongside a `_meta` envelope that must carry `clientInfo`, `clientCapabilities`, _and_ `protocolVersion`. The SDK reports each omission precisely (`-32020` / `-32602` with the missing key named), so this is discoverable — but B9's dual-protocol fixture has to build these headers, not just a body.

**The defect this tier would have shipped without an end-to-end probe.** `toNodeHandler` reads the raw request stream, and the API app installs `express.json()` globally, so the body was already drained: every HTTP call returned `-32700 Parse error: Invalid JSON`. Typecheck, unit tests, and integration tests were all green at that moment — only `verify:mcp` caught it. The fix hands the parsed body to the adapter explicitly, and passes `undefined` for GET/DELETE because express's `{}` placeholder reads as an empty JSON-RPC message.

**B8 and B10 came free.** `createMcpHandler` answers `server/discover` from the declared capabilities with no separate work, and its response carries `ttlMs: 0` / `cacheScope: "private"` — the conservative default B10 wanted, now observed rather than assumed.

**Deferred, with reasons:**

| #                          | Why deferred                                                                                                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B5 `serveStdio(factory)`   | STDIO keeps one long-lived instance and one connected transport, so the v1 `connect()` path still works unchanged. Adopting `serveStdio` buys dual-era STDIO, which no current client needs — and it is entangled with B7, because notifications today go through that same long-lived instance. |
| B6 identity from `_meta`   | `getClientVersion()` still resolves and is now merely deprecated (`tsc` flags it), so nothing is broken. The identity subsystem had uncommitted work from a concurrent session throughout this tier.                                                                                             |
| B7 `notify.toolsChanged()` | `TransportRouter.getHttpHandler()` exposes the `notify` facade this needs, but the STDIO path still notifies through its own instance. Doing B7 without B5 would leave two notification paths; they should land together.                                                                        |
| B9 dual-protocol fixture   | The e2e suite was updated to the stateless contract (below) and both eras were driven manually, but no automated fixture yet asserts them side by side.                                                                                                                                          |

**Test surface updated, not suppressed.** Seven e2e failures were the deleted session contract asserting itself. The SSE describe block was removed with the transport it exercised; `initialize` now asserts no session id is minted; and the two "MCP Spec Compliance" session tests were rewritten to the statelessness they now measure — a request with no session id, and one with a stale 2025-era header, are both served normally. `StreamableHttpMcpClient` no longer requires a session id but still sends one when present, so it can drive a 2025-era server too.

**Measured after:** typecheck green · lint ratchet 3413 errors / 1090 warnings (from 3437 / 1405 — the SSE deletion and v2's better types account for the drop) · tests-type ratchet 395, no regressions · 147 suites / 1784 unit tests · 34 suites / 434 integration · 3 suites / 34 e2e · `verify:mcp` 11/11 · `validate:arch` 0 errors · `validate:contracts` green.

**Two `validate:all` members fail on another session's uncommitted work, not this tier**: `validate:format` (6 files under `.github/`, `README.md`, `docs/guides/release-process.md`, `plans/acquisition-recovery.md`) and `validate:documented-options` (`docs/guides/cli.md`, `docs/guides/release-process.md` documenting their new `prepare:release-artifacts --output-dir`).

**Package count confirmed at two.** `@modelcontextprotocol/server@2.0.0` + `@modelcontextprotocol/node@2.0.0`; `core` arrives transitively and is not a direct dependency.

#### B9 + B6 (2026-08-02, second pass)

**B9 — the gate is now a test.** The dual-era proof was a manual `curl` probe; it is now six e2e cases in `mcp-server-smoke.test.ts` backed by a `ModernMcpClient` in the helper. The last one _is_ the tier gate: one server process, a 2025-era client and a 2026-07-28 client, asserting they see the same tool surface and that both complete a `tools/call`.

The header contract the first pass discovered is encoded in the client rather than in prose: `Mcp-Method` on every call, `Mcp-Name` on `tools/call`, and a `_meta` envelope carrying `clientInfo` / `clientCapabilities` / `protocolVersion`. Those key strings are **spelled out in the fixture rather than imported from the SDK** — importing them would make the test agree with the server by construction even if both drifted from the spec.

Two negative cases guard the edge: a request missing `Mcp-Method` is rejected before dispatch, and a _partial_ envelope is rejected naming the missing key.

**A wrong assumption the fixture corrected.** The first draft asserted that a request with no `_meta` is rejected. It is not — absence of an envelope is simply a 2025-era request, and `legacy: 'stateless'` serves it. That is the behavior that lets one build answer both revisions, so it now has its own passing test instead of a wrong failing one. Distinguishing "no envelope" (legacy) from "partial envelope" (modern, malformed) is the distinction that matters.

**B6 — identity, and a real gap it closed.** `getDetectedClientInfo()` now takes the per-request `extra` and reads `ctx.mcpReq.envelope['io.modelcontextprotocol/clientInfo']` first, falling back to the handshake value.

The envelope is not merely the newer source — **it is the only correct one over HTTP.** Since B1, every HTTP request is served by its own `McpServer`, so `this.mcpServer` is the STDIO instance and holds no handshake for that request. The pre-B6 code would have read identity off the wrong instance. Statelessness introduced that gap and B6 closes it; the deprecation warning was the visible symptom, not the substance.

`readEnvelopeClientInfo` is exported and unit-tested directly (13 cases) because it parses untrusted wire data the SDK does not validate: a non-string `version` is dropped rather than passed through to identity resolution.

**Measured after:** typecheck green · lint ratchet 3413 / 1090, no regressions · tests-type ratchet 395, no regressions · 148 suites / 1798 unit · 34 suites / 434 integration · 3 suites / 41 e2e · `verify:mcp` 11/11 · `validate:arch` 0 errors · `validate:contracts` green.

**Also fixed:** `startServerWithHttp` still defaulted to `transport: 'sse'`, a dangling reference to the transport B3 deleted. Now defaults to `streamable-http`.

**Remaining: B5 + B7 together.** The open decision is where notifications bind once `serveStdio(factory)` removes the long-lived instance `McpNotificationEmitter.setServer()` targets. `TransportRouter.getHttpHandler()` already exposes the `notify` facade for the HTTP half.

#### B5 + B7 (2026-08-02, final pass) — Tier B complete

**What B5 actually bought, measured before building it.** The old path connected an `McpServer` straight to a `StdioServerTransport`. Probed against that build, STDIO answered a modern `tools/list` — but only because the protocol layer is permissive. `server/discover` and `subscriptions/listen` both returned `-32601`, and the request `_meta` envelope was never lifted, so B6's identity read had nothing to find there. STDIO was 2025-era wearing a modern coat. After `serveStdio`, all three work and the legacy handshake still answers.

**The design fork resolved by reading the type.** `StdioServerHandle` exposes only `close()` — there is no `notify` facade on it, unlike `McpHttpHandler`. So the pinned instance is the only thing that can push over STDIO. `createStdioServerFactory()` wraps the shared factory and captures the instance as `serveStdio` pins it. HTTP needs no equivalent and gets none.

**A defect B5 introduced and B7 had to fix.** `McpToolRouter` was constructed with the server built at foundation time — but `serveStdio` pins a _different_ instance. Both `sendToolListChanged()` and B6's legacy identity fallback were left pointing at a never-connected object, and would have failed silently. `setPinnedServer()` closes it; `setToolsChangedNotifier()` moves the routing to the runtime, the only layer that knows which transport is live. This is precisely why the two steps could not be split.

**A dead channel that turned out to be a missing producer.** `notifyResourcesChanged` had no production caller (A2 had removed its only import), so the first move was to delete it. An integration suite then failed to load — it had a _test_ consumer. `cleanup-standards.md` §Test Surface Audit says to grep `tests/` as well as `src/`; that step was skipped and the suite caught it.

The deletion was also the wrong call on the merits. Resources project `_convertedPrompts`, which prompt hot-reload replaces, so a reload does change the resource list — clients were simply never told. Zero writers with a live reader meant a **missing producer**, not a redundant channel. The function is restored as the STDIO-path primitive, routed alongside `toolsChanged`, and given the producer it never had at the hot-reload completion in `handlePromptHotReload`.

**One extraction, not for arithmetic.** Adding the factory and notifier pushed `application.ts` past the 1000-line ESLint warning and the ratchet blocked it. Rather than raise the baseline, `registerMcpResources` moved to `runtime/resource-registration.ts` — it is a distinct responsibility (projecting runtime managers onto the resources module's dependency bag, where optional subsystems become omitted capabilities rather than crashes) and it is called once per serving unit. `application.ts` 1341 → 1285 lines; the warning cleared on its own.

**Measured after:** typecheck green · lint ratchet 3363 / 1072, no regressions (from 3413 / 1090) · tests-type ratchet 395, no regressions · 148 suites / 1798 unit · 34 suites / 434 integration · 3 suites / 41 e2e · `verify:mcp` 11/11 · `validate:arch` 0 errors, 439 modules · `validate:contracts` green.

**Tier B gate, both transports:**

| Transport | 2025-era                         | 2026-07-28                                                 |
| --------- | -------------------------------- | ---------------------------------------------------------- |
| HTTP      | `verify:mcp` 11/11 + e2e fixture | e2e fixture: `tools/list`, `server/discover`, `tools/call` |
| STDIO     | `initialize` answers             | `server/discover` answers (was `-32601`)                   |

### Tier C — dynamic tool-schema reconfiguration

| #   | File                                                | Change                                                                                       | ~Lines | Depends | Verify                                         |
| --- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------ | ------- | ---------------------------------------------- |
| C1  | `src/mcp/tools/schemas/prompt-engine.schema.ts:69`  | `DescriptionResolver` → `ToolSurfaceResolver` (state → shape + description)                  | ~50    | B gate  | same state ⇒ identical schema, twice           |
| C2  | `src/mcp/tools/schemas/prompt-engine.schema.ts:43`  | Decompose the cyclomatic-13 builder while widening                                           | ~30    | C1      | `npx eslint` clean on that function            |
| C3  | `src/mcp/tools/schemas/prompt-engine.schema.ts:160` | `PromptEngineInput` re-inference (`z.infer<ReturnType<…>>`) + its consumer at `index.ts:593` | ~10    | C1      | `tsc --noEmit`                                 |
| C4  | `src/runtime/` factory                              | Factory calls builder per request                                                            | ~15    | C1      | request under framework X advertises X's shape |
| C5  | `src/mcp/tools/index.ts:887-916`                    | STDIO path: `update({ paramsSchema })` + `notify.toolsChanged()`                             | ~30    | C1, B7  | live reshape on one connection                 |
| C6  | `src/mcp/tools/index.ts:883-885`                    | Replace the stale comment with the real constraint (per-request vs long-lived)               | 5      | C5      | no future reader re-derives the wrong limit    |
| C7  | `tooling/contracts/prompt-engine.json`, `CLAUDE.md` | Reconcile contract SSOT with a state-dependent surface; record the D2 ruling                 | ~40    | C1, D2  | `validate:contracts` green                     |

**Tier C gate**: diffing `tools/list` across a framework switch shows a changed `inputSchema` — not merely a changed description string.

### Tier D — documentation reconciliation

| #   | File                                                                                                                                                                                                                     | Change                                     | Depends |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ------- |
| D1a | `CLAUDE.md`                                                                                                                                                                                                              | Core Principle 3 → STDIO + Streamable HTTP | D1      |
| D1b | `CONTRIBUTING.md:102`, `project-decisions.md:143-156,325`, `docs/adr/README.md:13`, `docs/adr/0000-template.md:53`, `docs/adr/0001-*.md:35,319`                                                                          | Reconcile SSE-parity statements            | D1      |
| D1c | `docs/architecture/overview.md:32,154,781-782`, `docs/portfolio/design-decisions.md:29-37`, `docs/reference/mcp-tools.md:1008-1011`, `docs/guides/troubleshooting.md:225`, `docs/TODO.md:17,124`, `server/README.md:394` | Same                                       | D1      |
| D2a | `CHANGELOG.md`                                                                                                                                                                                                           | Entry (below)                              | C gate  |

---

## Risks

| Risk                                               | Mitigation                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Typecheck blind at the most-changed seams          | A0 first — this is why it is not folded into A2                                         |
| Stage C no-ops over HTTP if built as mutation-only | Pure state→schema function; verified against `d.cts:3769-3776`                          |
| Clients never learn of a reshape                   | C depends on B7 — `toolsChanged` needs `subscriptions/listen` opt-in under the new spec |
| Stale client caches a dynamic surface              | B10 keeps `ttlMs: 0` (SDK's conservative default)                                       |
| SSE deletion misses dangling reads                 | B3 scope corrected to include `372, 386-387`, not just `145-234`                        |
| 28 validators unexercised against v2 imports       | Tier A gate runs `validate:all` whole before B begins                                   |

## Out of scope

Chain/SQLite redesign (unaffected) · Roots/Sampling/Logging adoption (unused, deprecated) · MRTR feature work (legacy shim is default-on) · tasks extension · multi-process `ServerEventBus` · decomposing `application.ts` (1278 lines, Critical, but unrelated — bundling would make Tier A un-attributable)

## Validation

| What to test                                   | Type        | Location                                                                                     | Why this type                                                                                               |
| ---------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| All 3 MCP tools answer after the package swap  | smoke       | `npm run verify:mcp`                                                                         | Existing gate; spawns from `dist/` and refuses a stale build                                                |
| Handler `ctx` signature + header reads         | unit        | `tests/unit/mcp-tools/`                                                                      | Pure input→output; no transport needed                                                                      |
| Client identity from `_meta` envelope          | unit        | `tests/unit/mcp-tools/request-identity-resolver.test.ts`, `identity-policy-boundary.test.ts` | Existing assertions already cover the identity contract; extend rather than duplicate                       |
| Both protocol eras against one build           | e2e         | `tests/e2e/helpers/http-mcp-client.ts` (new fixture)                                         | Only an end-to-end client can prove era negotiation; the whole point of `legacy:'stateless'`                |
| Chain run survives statelessness               | integration | `tests/integration/`                                                                         | Chains span calls; a unit test cannot show run state surviving without protocol sessions                    |
| `tools/list` reshapes on framework switch      | integration | `tests/integration/`                                                                         | Requires a real switch + two list calls; the assertion that separates schema change from description change |
| `subscriptions/listen` delivers `toolsChanged` | e2e         | `tests/e2e/`                                                                                 | Needs a live stream; unobservable in-process                                                                |

### Done criteria

| Criterion                          | Validation                                                                           | Pass condition                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Tier A complete                    | `npm run typecheck && npm run validate:all && npm run test:ci && npm run verify:mcp` | all green; `rg '@mcp-codemod-error'` and `rg 'McpError'` both empty                  |
| Type visibility restored           | `npx eslint src/mcp/tools/index.ts`                                                  | no `no-unsafe-call` / `no-unsafe-member-access` at :757, :814, :899                  |
| Tier B complete                    | dual-protocol e2e fixture                                                            | a `2026-07-28` and a `2025-11-25` client each complete a chain run against one build |
| SSE fully removed (if D1 = delete) | `rg 'sseTransports\|SSEServerTransport\|transport=sse'`                              | zero hits in `server/src/` and `server/package.json` scripts                         |
| Sessions fully removed             | `rg 'sessionIdGenerator\|Mcp-Session-Id'`                                            | zero hits in `server/src/`                                                           |
| Tier C complete                    | diff `tools/list` across a framework switch                                          | `inputSchema` differs, not only `description`                                        |
| Contracts in sync                  | `npm run validate:contracts`                                                         | green; no diff under `_generated/`                                                   |
| Docs consistent                    | `rg -n '\bSSE\b' --glob '!node_modules'`                                             | every remaining hit reflects the D1 decision; no parity claims survive               |

### Risks and rollback

| Risk                                               | Impact                                                                   | Mitigation                                                      | Rollback                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| Typecheck blind at the most-changed seams          | Silent breakage reaching `main`                                          | A0 precedes A2 — the reason for its ordering                    | revert A0 (3 files, ~9 lines)                                        |
| Stage C no-ops over HTTP if built as mutation-only | Capability appears to work in STDIO tests, absent in production          | Pure state→schema function, verified against `d.cts:3769-3776`  | Tier C is independently revertable; A+B stand alone                  |
| Clients never learn of a reshape                   | Feature ships unobserved                                                 | C depends on B7 (`subscriptions/listen` opt-in)                 | —                                                                    |
| 28 validators unexercised against v2 imports       | `validate:arch` / `validate:no-crosslayer-*` may reject v2 import shapes | Tier A gate runs `validate:all` whole before B begins           | adjust validator config, or revert A1-A2                             |
| Legacy HTTP consumer breaks on SSE deletion        | External breakage                                                        | D1 is an explicit operator decision, not a default              | restore from the B3 commit; it is a single deletion commit by design |
| B9 estimate is the least grounded number here      | Schedule slip in Tier B                                                  | Called out explicitly; no existing fixture drives two revisions | —                                                                    |

### Release

- **Commit convention**: `feat(mcp-tools)`, `refactor(runtime)`, `chore(deps)` per tier; SSE removal is `feat(runtime)!` with a `BREAKING CHANGE:` footer if D1 = delete.
- **Semver**: the SSE removal and any `server/discover` surface change touch the declared Public API Contract → **major**. Tiers A and C alone would not require one under the D2 "union" ruling.
- **Scopes in play**: `mcp-tools`, `runtime`, `pipeline`, `contracts`, `deps`, `docs`, `tests`.

### Growth capture

- Pattern worth capturing: _"a published package's `.d.ts` is the authority when the docs site is a stub"_ — the `npm pack` + read-declarations move resolved three open unknowns and corrected a wrong-package citation that documentation alone would have propagated.
- Pattern worth capturing: _"an `any`-typed or string-index-cast seam silently disables the type checker at exactly the site a migration changes"_ — generalizes past this migration; candidate for `/refactoring` pre-flight as a `contracts` sub-check.
- Repo defect found while planning: the Phase 2.5 prompt template names its required sections `context_establishment` / `systematic_analysis` / `goal_definition`, but the stage-09b phase guard checks for `Context` / `Analysis` / `Goals`, and appears to measure only text outside code fences — so a Phase 3 response that puts `plan_table` under `## Execution` as the template instructs fails the guard. Two template/guard disagreements in one chain.

## Changelog entry

```
### Changed
- Migrated to MCP TypeScript SDK v2 scoped packages and added support for
  protocol revision 2026-07-28, served alongside 2025-11-25 clients.
- Tool parameter surfaces are now derived from active framework and gate state,
  so gate constraints are expressed in the tool schema rather than in prose.

### Removed
- The deprecated HTTP+SSE transport and the protocol session registry.
```

## Evidence

Verified 2026-08-01 against: `@modelcontextprotocol/server@2.0.0` and `@modelcontextprotocol/node@2.0.0` published tarballs (declaration files read directly — the docs site returned a stub); [spec changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog); [v1→v2 migration guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md); [2026-07-28 server support guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md); and `npx eslint` / `rg` / `wc -l` over the repo.

All repo line numbers were re-verified against the filesystem after the design phase. Four citation drifts were corrected in the process, listed here so a later reader does not re-derive them: `sessionIdGenerator` is at `:274` not `:273`; the SSE deletion span includes `372, 386-387`; `toNodeHandler` is declared in `@modelcontextprotocol/node` `index.d.cts:249`, not in the server package; `McpServerFactory` is at `d.cts:3810`.
