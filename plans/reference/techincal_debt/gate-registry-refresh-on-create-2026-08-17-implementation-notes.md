---
title: "Implementation notes — gate registry refresh on create (F17)"
date: 2026-08-18
status: reference
tags:
  - gates
  - mcp-tools
  - resources
---

# Implementation notes — gate registry refresh on create (F17)

Plan: `gate-registry-refresh-on-create-2026-08-17.md`. Root cause traced 2026-08-18 via `>>diagnose`
and recorded in the plan; fixes landed the same day.

## What shipped

| Fix | File                                         | Change                                                                                                                                                                                                 |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `gate-lifecycle-processor.ts` `handleCreate` | Calls `gateManager.reload(id)` after a successful write, the pattern `handleUpdate` already used, and branches the response on the result instead of claiming "Gate registry reloaded" unconditionally |
| 2   | same, `handleDelete`                         | Dropped the `gateManager.has(id)` guard; the directory-existence check below it is delete's real authority. Closing message now reports which of the two removals happened                             |
| 3   | same, `handleReload`                         | Dropped the same `has(id)` guard so reload can register an unregistered id; failure message now names the path it looked at                                                                            |
| 4   | same, `handleDelete` `dry_run`               | Corrected a false promise — see DEV-4                                                                                                                                                                  |

## DEV-1 — the existing test harness was more capable than production, which is why the suite was green

`gate-framework-versioning.integration.test.ts` wires its double's `onRefresh` to
`registry.reload(GATE_ID)`, and its `run()` helper reloads after **every** action. Production does
neither: the gate handler's `onRefresh` resolves to the application's full server refresh, which
reloads prompt data and never touches the gate registry.

So the harness handed every test a registry that refreshed itself, and F17 was structurally
invisible to it — no assertion in that file could have failed on this defect. The new tests are a
separate `describe` with their own context whose `onRefresh` only increments a counter, plus direct
handler calls with no auto-reload between them.

This is the general lesson, not a one-off: **a double that is more capable than the collaborator it
stands in for cannot fail in the ways production fails.** The counter is retained in the new
harness specifically so a future edit that "helpfully" makes that `onRefresh` reload gates has to
delete an assertion to do it.

## DEV-2 — a pre-existing unit test asserted the behaviour Fix 2 removes

`tests/unit/mcp-tools/gate-manager/manager.test.ts` had `delete fails cleanly when gate is missing
from registry`, asserting `Gate 'missing-gate' not found`. That is exactly the registry-authority
Fix 2 moves to the filesystem, so the test failed — correctly, and it is the only thing that
flagged the blast radius.

Renamed to `delete fails cleanly when there is nothing on disk to delete` and re-pointed at
`Gate directory not found`, with the reasoning inline. Added a sibling test that deletes a gate
present on disk and absent from the registry, which is the orphan case the fix exists for and which
nothing covered.

## DEV-3 — Fix 3 was beyond the literal request; flagged for independent rejection

The operator asked for the create message and the delete guard. Fix 3 (the reload guard) was not
asked for. Included because it is the identical guard in the same file, and because without it
Fix 1's failure branch has nowhere to point: telling an operator to run `action:"reload"` only helps
if reload can register an id the registry does not know.

It is a self-contained hunk in `handleReload` and can be reverted alone without disturbing 1, 2 or 4.

## DEV-4 — the drive found a fourth false claim, in delete's own preview

`dry_run` on delete promised "📜 Would purge this gate's rows from `version_history`". Nothing on
the gate delete path calls `deleteHistory`; the rows survive. Found by driving the same gate id
twice and seeing history report 4 versions across two create/delete cycles.

Corrected the text rather than adding the purge. The prompt path already documents the same
behaviour as a deliberate choice (`prompt-lifecycle-processor.ts:661` — rows survive but become
unreachable because rollback resolves the resource first), so purging on the gate path would have
made the two resource types disagree on a durable table, which is the exact defect class the
resource-versioning initiative just finished removing. The inconsistency worth noting is that gates
and prompts now behave the same and only gates ever claimed otherwise.

## DEV-5 — my own drive harness produced two false readings

The probe script truncated tool responses to 150-160 characters for readability. That silently:

1. hid the chain resume token in a footer, making a cancel drive report "chain id NOT FOUND"; and
2. reported `list` as `MISSING from list` for a gate that was present — the listing is 1,330
   characters and the new gate sorted past the cut.

Both looked like product defects and neither was. Fixed by adding an untruncated `callFull` for any
assertion about content, keeping truncation only for display. Recorded because the failure mode is
attractive: a truncated response reads as a complete one, and "not present in this string" is a
conclusion the harness is not entitled to draw.

## Verification

- 16/16 in the gate versioning integration file; the 5 new coherence tests shown RED against the
  pre-fix source (registry membership false, "NOT active" absent, delete and reload both refusing,
  and the reload error still pointing at the id instead of the disk path)
- `typecheck` clean · `lint:ratchet` no regressions · `typecheck:tests:ratchet` 371 no regressions ·
  `test:ci` 198 suites / 2633 passed
- Per-rule ESLint diff on the changed file, pre versus post: identical (1 `no-unnecessary-condition`,
  5 `prefer-nullish-coalescing`, 15 `strict-boolean-expressions`) — no new violations hiding inside a
  green ratchet
- **Live drive**, streamable-http, one process, no restart: create → inspect → update → history →
  reload → list → delete all succeed, `reload` of an unknown id fails naming the path it checked,
  and the create→delete round trip leaves no orphaned directory. `git status server/resources/`
  returns only the two files the concurrent session already had modified.

## Still open

- Framework write rollback ("Mutation produced invalid resource state; restored prior") — deferred
  by operator decision, needs its own reproduction
- OQ-3 in the plan (await-refresh versus read-through-on-miss) remains open; Fix 1 takes the
  await-refresh shape without foreclosing the other
