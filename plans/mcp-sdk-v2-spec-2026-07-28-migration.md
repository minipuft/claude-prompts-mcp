# MCP SDK v2 + Spec 2026-07-28 Migration

**Status**: Approved — D1 and D2 decided 2026-08-01 (operator confirmed both recommendations). Tier A in progress.
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

| #   | Status | File                                      | Change                                                                                                                                                                                                                             | Verify result                                                                                                            |
| --- | ------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A0a | ✓      | `src/mcp/tools/index.ts:97,138,996`       | Type `mcpServer: any` → `McpServer` — **three sites, not one**: the class field (`:97`, the root cause), the constructor param (`:138`), and the factory param (`:996`). Added `McpServer` + `Implementation` imports.             | 7 unsafe-call/unsafe-member-access reports at `:757`, `:814`, `:899`, `:900` cleared                                     |
| A0b | ✓      | `src/mcp/tools/index.ts:81-88`            | Replaced the string-indexed cast in `readClientVersion` with a typed call returning `Implementation \| undefined`; simplified `getDetectedClientInfo` (`:310`) whose defensive `as Record<string, unknown>` casts became redundant | `tsc --noEmit` green; the handshake path is now compiler-visible                                                         |
| A0c | ✓      | `src/mcp/tools/index.ts:1021-1022`        | No change required — `McpToolRouter as McpToolsManager` and `createMcpToolsManager = createMcpToolRouter` inherit the now-typed symbols by construction                                                                            | `tsc --noEmit` green                                                                                                     |
| A0d | ✓      | `src/infra/http/transport/index.ts:36,44` | **Not in the original plan.** A _fourth_ `mcpServer: any` — found because it is what concealed the transport/server coupling that blocks A1. Typed to `McpServer`.                                                                 | `tsc` now reports `'SSEServerTransport' is deprecated` at `:10`, `:39`, `:146` — three warnings the `any` had suppressed |

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

### Why A1-A4 moved to Tier B

The plan assumed the codemod could run standalone against a v1→v2 package swap. Execution disproved that. Measured facts:

- The SDK import surface is **14 files, 5 import paths** — smaller than feared.
- **No test file imports the SDK** (`tests/e2e/helpers/http-mcp-client.ts` hand-rolls JSON-RPC over `node:http`). So `@modelcontextprotocol/client@2.0.0` is **not** needed. A1's open question is resolved: three packages, not four.
- v2 has **no `SSEServerTransport`** (expected) **and no `StreamableHTTPServerTransport`** (not anticipated) — it offers `PerRequestHTTPServerTransport` and `WebStandardStreamableHTTPServerTransport` instead.
- `transport/index.ts:90,158` calls `this.mcpServer.connect(transport)` on the **same instance** `application.ts` constructs. Server and transports must therefore come from the same SDK major.

**Consequence**: v1/v2 coexistence — which the migration guide otherwise blesses for staged migrations — is **not viable here**. Swapping the package forces the transport rewrite, which forces both the SSE deletion (D1) and `createMcpHandler`/`serveStdio` adoption. A1-A4 are atomic with B1-B5.

**Restructure**: A1-A4 fold into Tier B as its opening steps. Tier A stands as the type-visibility tier — small, verified, independently revertable, and the thing that made the coupling visible. 13 of 14 files still migrate mechanically; only `transport/index.ts` needs design work, and it needed it anyway.

**Knock-on for B9**: since the e2e helper is hand-rolled JSON-RPC rather than an SDK client, adding a second protocol era means hand-writing the 2026-07-28 `_meta` envelope, not swapping a client class. B9 was already flagged as the least grounded estimate in the plan; this raises it further.

### Tier B — spec 2026-07-28 support

| #   | File                                                               | Change                                                                                                  | ~Lines | Depends | Verify                                                        |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------ | ------- | ------------------------------------------------------------- |
| B1  | `src/runtime/application.ts:235-265`                               | Extract `McpServerFactory` closure over existing singletons                                             | ~60    | A gate  | factory returns a working `McpServer`                         |
| B2  | `src/infra/http/transport/index.ts`                                | `createMcpHandler(factory, { legacy: 'stateless' })` + `toNodeHandler` into Express                     | ~80    | B1      | dual-era smoke test                                           |
| B3  | `src/infra/http/transport/index.ts:9,38,145-234,**372,386-387**`   | **Delete SSE** (pending D1)                                                                             | −150   | B2, D1  | `rg 'sseTransports'` → empty                                  |
| B4  | `src/infra/http/transport/index.ts:39,252-296,**274**,392`         | Delete session registry + `sessionIdGenerator`                                                          | −60    | B2      | `rg 'sessionIdGenerator'` → empty                             |
| B5  | `src/runtime/startup-server.ts`                                    | `serveStdio(factory)`                                                                                   | ~20    | B1      | `verify:mcp` on stdio                                         |
| B6  | `src/mcp/tools/index.ts:86,305-339`                                | Identity: `getClientVersion()` → `ctx.mcpReq.envelope`                                                  | ~40    | B1, A0b | `request-identity-resolver` + `identity-policy-boundary` pass |
| B7  | `src/mcp/tools/index.ts:899`, `src/modules/resources/index.ts:131` | `sendToolListChanged`/`sendResourceListChanged` → `handler.notify.toolsChanged()`/`.resourcesChanged()` | ~25    | B2      | subscriber receives event                                     |
| B8  | `src/runtime/application.ts:241-244`                               | `capabilities` block → `server/discover`                                                                | ~15    | B1      | discover advertises all three surfaces                        |
| B9  | `tests/e2e/helpers/http-mcp-client.ts`                             | Dual-protocol fixture                                                                                   | ~120   | B2      | drives both revisions against one build                       |
| B10 | —                                                                  | Cache posture: keep `tools/list` at `ttlMs: 0` (SDK default), recorded as a deliberate choice           | doc    | B2      | stated in this file                                           |

**Tier B gate**: a `2026-07-28` client and a `2025-11-25` client both complete a chain run against one build.

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
