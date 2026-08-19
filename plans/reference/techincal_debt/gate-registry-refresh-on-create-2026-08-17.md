---
title: "A gate created through resource_manager is invisible until restart"
date: 2026-08-17
status: reference
tags:
  - gates
  - mcp-tools
  - resources
---

# Gate registry does not learn about a gate it just created (F17)

**Area**: `server/src/mcp/tools/gate-manager/services/gate-lifecycle-processor.ts`, the gate
registry refresh path, `server/src/modules/gates/`
**Work type**: bug_fix
**Severity**: High
**Origin**: promoted out of `resource-versioning-consolidation-2026-08-17.md`, where it was
measured during the Tier 7 live drive and ruled out of scope. That plan is now `reference`; this
file carries the finding forward so it is not only recorded in an implementation-notes appendix.

## The defect, as measured

Measured 2026-08-17 on the live STDIO path:

1. `resource_manager resource_type:"gate" action:"create"` reports success and writes both
   `gate.yaml` and `guidance.md` to disk.
2. Every subsequent action on that id — `update`, `reload`, `history`, `inspect`, `rollback` —
   answers `Gate 'X' not found`.
3. An explicit `action:"reload"` does **not** fix it.
4. The registry only learns about the gate on server restart.

**Not caused by the versioning initiative.** That work's diff for `gate-lifecycle-processor.ts`
touches only the versioning block in `handleUpdate` and the `dry_run` branch in `handleDelete`.
`handleCreate`, the refresh call, and `modules/chains/manager.ts` are unchanged.

## Why it matters more than a stale cache usually would

`create` returns **success**. The operator has no signal that the resource they just made is
unusable, and the natural next action — `update` or `inspect` — fails with a not-found message that
points at the id rather than at the registry. The two failure modes an operator would guess (wrong
id, failed write) are both wrong, and the file is on disk to confirm the write worked.

It also blocks verification elsewhere: the versioning plan's Final Verify reads "create a gate,
update twice, history, dry_run rollback, rollback, reload, inspect" and **cannot be performed as
written** until this is fixed. That drive had to be re-pointed at a gate registered at startup,
which is a weaker probe — it cannot observe the create→use seam at all.

## Root cause — traced 2026-08-18 via `>>diagnose`

`handleCreate` (`gate-lifecycle-processor.ts:46`) calls `await this.ctx.onRefresh?.()`. That
callback is wired at `index.ts:265` from `initialize(onRefresh, …)`, supplied at
`module-initializer.ts:252` as `callbacks.fullServerRefresh`, which is
`application.ts:756`.

`fullServerRefresh` does five things: `loadAndProcessData()` (prompts), `mcpToolsManager.updateData(...)`,
`apiRouter.updateData(...)`, a resource-index re-sync, and `publishPromptsChanged`. **It contains no
gate registry call.** The registry keeps the snapshot it built at startup, so the written gate is
real and durable and unknown to every in-memory lookup.

Confirmed by differential drive rather than by reading: prompt `create → inspect → update → delete`
all succeed in one process, which is exactly what "the refresh reloads prompts" predicts, and the
control (`inspect code-quality`) works in the same session. So this is not general refresh failure,
not router dispatch, and not the tool surface.

### The fix lever — a recovery path guarded by the condition it exists to fix

`GateRegistry.reloadGuide` (`gate-registry.ts:342`) **already works on a brand-new gate**: it clears
the loader cache, loads fresh from disk, and does `this.guides.set(normalizedId, entry)`
unconditionally — every read of `existingEntry` is optional-chained with a default. Nothing in it
requires the gate to be known, and it already returns `false` when `loadGate` finds nothing on disk.

But `handleReload` (`gate-lifecycle-processor.ts:217`) does
`if (!this.ctx.gateManager.has(id)) return error('not found')` **before** reaching it. The one
operation that could self-heal is refused by a check for the very state it would repair. That is why
an explicit `action:"reload"` fails, and why the condition looks unrecoverable from the tool surface.

| Option | Change                                                                                                 | Reach                                                 |
| ------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| (a)    | Drop the `has()` guard on reload; let `reloadGuide`'s own disk check answer                            | Fixes every gate that drifts for any reason; ~2 lines |
| (b)    | Have `handleCreate` call `gateManager.reload(id)` directly, as `handleUpdate` already does at line 133 | Fixes the reported symptom only                       |

They compose; (a) is the one that generalizes. Settling OQ-3 below decides whether either is enough.

## Open questions

| id   | Question                                                                                         | Status                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| OQ-1 | Does `reload` fail for lack of an entry, or against stale state?                                 | **ANSWERED 2026-08-18 — neither.** It is refused by a `has()` guard before it runs; the underlying reload would have worked  |
| OQ-2 | Do frameworks and prompts share the seam?                                                        | **PARTIALLY ANSWERED 2026-08-18.** Prompts: **no** — driven clean end to end. Frameworks: **unverified by drive**, see below |
| OQ-3 | Should `create` await a registry refresh, or should the registry read through to disk on a miss? | Open (as of 2026-08-18 · flips when the fix option above is chosen)                                                          |

OQ-3 remains the design fork: awaiting a refresh keeps reads cheap and makes `create` honest; a
read-through miss handler fixes every path at once but puts I/O behind what callers treat as a
lookup.

## Adjacent findings from the same session

**A false success message.** `handleCreate` returns text that states "🔄 Gate registry reloaded"
unconditionally, after an optional-chained call it never checks. The callback is wired, so the
optional chain is not the active bug — but the sentence asserts an outcome nothing verified, and it
is false today. This is what makes the failure disorienting: create says success AND says the
registry reloaded, so both things an operator would naturally suspect (wrong id, failed write) are
wrong while the file on disk proves the write worked.

**The framework path shares the seam by construction, but was not confirmed by drive.** Its
production `onRefresh` (`index.ts:597-600`) is a comment and a `logger.debug` — no reload of
anything. Recorded as reading, not measurement, because framework `create` never succeeded across
three attempts: escalating validation demands (`phases` required, then `framework_gates` required),
then the writer itself returning "Framework write failed and was rolled back: Mutation produced
invalid resource state; restored prior". **That rollback is its own defect** and may mean framework
create is unusable through the tool independent of this one. It needs its own reproduction.

**`delete` cannot clean up what `create` made.** Because `handleDelete` also guards on registry
membership, the orphaned directory has to be removed by hand. Any fix should confirm the
create → delete round trip, not only create → inspect.

## Done criteria

| Criterion             | Validation                                         | Pass condition                                                          |
| --------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| Create is usable      | Live drive over STDIO                              | `create` then `inspect` on the same id succeeds without a restart       |
| Every action reaches  | Live drive                                         | `update`, `reload`, `history`, `rollback` all resolve a just-created id |
| Regression test       | integration, real write path                       | A test creates a gate and immediately updates it, red against HEAD      |
| Parent plan unblocked | The versioning plan's Final Verify runs as written | create → update ×2 → history → dry_run rollback → rollback → inspect    |
| Siblings checked      | OQ-2 answered for framework and prompt create      | Either shown unaffected, or fixed in the same pass                      |
