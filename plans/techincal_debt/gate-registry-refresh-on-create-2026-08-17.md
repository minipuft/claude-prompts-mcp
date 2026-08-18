---
title: "A gate created through resource_manager is invisible until restart"
date: 2026-08-17
status: backlog
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

## Open questions to settle before implementing

| id   | Question                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| OQ-1 | Does `reload` fail because the registry has no entry to reload (reload is keyed on a known id), or because the refresh runs against stale state? |
| OQ-2 | Do frameworks and prompts have the same seam, or does only the gate path miss the post-create refresh?                                           |
| OQ-3 | Should `create` await a registry refresh before returning, or should the registry read through to disk on a miss?                                |

OQ-3 is the design fork: awaiting a refresh keeps reads cheap and makes `create` honest; a
read-through miss handler fixes every path at once but puts I/O behind what callers treat as a
lookup. Settle it before editing — this is the same reuse-versus-extend question the parent plan
recorded for the confirmation guard.

## Done criteria

| Criterion             | Validation                                         | Pass condition                                                          |
| --------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| Create is usable      | Live drive over STDIO                              | `create` then `inspect` on the same id succeeds without a restart       |
| Every action reaches  | Live drive                                         | `update`, `reload`, `history`, `rollback` all resolve a just-created id |
| Regression test       | integration, real write path                       | A test creates a gate and immediately updates it, red against HEAD      |
| Parent plan unblocked | The versioning plan's Final Verify runs as written | create → update ×2 → history → dry_run rollback → rollback → inspect    |
| Siblings checked      | OQ-2 answered for framework and prompt create      | Either shown unaffected, or fixed in the same pass                      |
