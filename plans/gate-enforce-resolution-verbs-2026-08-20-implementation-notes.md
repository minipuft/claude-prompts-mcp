---
title: "Implementation notes: gate-enforce resolution verbs"
date: 2026-08-20
status: active
tags: [hooks, contracts, gates]
---

# Implementation Notes — gate-enforce resolution verbs

Companion to `gate-enforce-resolution-verbs-2026-08-20.md`. Created before first edit.

## Deviations

- The contract's tool id is `prompt_engine` (underscore), not the file-name spelling
  `prompt-engine` — first generator run silently produced nothing because the find predicate
  used the hyphenated form. Fixed; the empty-set throw would not have caught this (it guards a
  found-but-unflagged contract, not a missed lookup).
- Adding one optional field to `parameterSchema` regenerated all five `*.generated.ts` files:
  the `ToolParameter` interface text is emitted per-tool by the generator. Cosmetic churn,
  generator-owned, committed as generated.
- `hooks/README.md`'s gate-enforce table documented a "Missing user_response" check that the
  hook never implemented (pre-existing doc drift). Rewritten to current state rather than
  preserved.

## Validation Ledger

- 2026-08-20: `generate:contracts` ✓ · `validate:contracts` ✓ · `typecheck` ✓ ·
  `lint:ratchet` ✓ (3109/1004, no regressions) · `typecheck:tests:ratchet` ✓ (369, no
  regressions) · `validate:python` ✓ (234 passed) · `npm test` ✓ (2679 passed) ·
  new tests verified load-bearing (7/8 fail against `git show HEAD:hooks/gate-enforce.py`)
