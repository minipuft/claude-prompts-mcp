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

## Deviations

_(none yet — no implementation has started)_
