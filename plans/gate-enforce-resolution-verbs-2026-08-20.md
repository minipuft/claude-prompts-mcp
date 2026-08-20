---
title: "gate-enforce.py consumes the contract's resolution verbs"
date: 2026-08-20
status: active
tags: [hooks, contracts, gates]
---

# gate-enforce.py Consumes the Contract's Resolution Verbs

## Defect

`hooks/gate-enforce.py` Check 2 denies any `prompt_engine` call carrying `chain_id` without
`gate_verdict` while a gate is pending. It reads only those two parameters, so the server's
gate-independent exits — `cancel: true` (short-circuits before the pipeline,
`prompt-executor.ts:435`) and `gate_action: retry|skip|abort` (handled by
`gate-enforcement-authority.ts:467`) — are denied by the hook before the server sees them.
A pending gate therefore blocks its own abort; the only working exit was
`system_control session clear`, which the hook's tool-name matcher doesn't cover.

Root cause: the hook maintains a private model of "valid moves while a gate is pending,"
independently of the server's contract. Second occurrence of this rot —
`gate_action: "abort"` itself was added because the only exit was `system_control session cancel`.

## Design (interviewed with owner 2026-08-20)

1. `gate-enforce.py` stays the single gate hook; its private verb model is replaced by a
   generated artifact.
2. All of `cancel: true` and `gate_action: retry|skip|abort` pass while a gate is pending;
   only a chain_id call carrying no resolution parameter is denied.
3. Deny message is verdict-first, with the exits named as a fallback line.
4. `generate:contracts` emits `hooks/lib/_generated/resolution_verbs.py` from parameters
   flagged `resolvesPendingGate: true` in `tooling/contracts/prompt-engine.json`; staleness is
   covered by the existing `validate:contracts --check` path. The artifact ships downstream via
   the existing `prepack` rsync of `hooks/`.
5. Missing/unreadable artifact at runtime → hook fails open (skips Check 2); the server is the
   enforcement authority.

## Rows

| #   | Task                                                                                                                                                                            | Status                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `parameterSchema` gains optional `resolvesPendingGate`; flag set on `gate_verdict`, `gate_action`, `cancel` in `prompt-engine.json`                                             | ✓ DONE (2026-08-20 · validated via generate:contracts + typecheck)                                                                                             |
| 2   | Generator emits `hooks/lib/_generated/resolution_verbs.py` (+`__init__.py`); throws if the flagged set is empty                                                                 | ✓ DONE (2026-08-20 · artifact at hooks/lib/_generated/resolution_verbs.py; validate:contracts green; empty-set throw in generator)                             |
| 3   | `gate-enforce.py` Check 2 consumes the generated set; fail-open on import failure; verdict-first deny message                                                                   | ✓ DONE (2026-08-20 · gate-enforce.py Check 2 rewritten; fail-open on import failure)                                                                           |
| 4   | Regression tests: pending gate × {cancel, retry, skip, abort} allow; bare resume denies; cancel:false denies; fail-open path; artifact parity                                   | ✓ DONE (2026-08-20 · 8 new tests; 7 fail against pre-fix hook, 12/12 pass after)                                                                               |
| 5   | `hooks/README.md` gate-enforce entry updated                                                                                                                                    | ✓ DONE (2026-08-20 · README table rewritten (also removed a never-implemented "Missing user_response" row))                                                    |
| 6   | Validation: `generate:contracts`, `validate:contracts`, `typecheck`, `validate:python`                                                                                          | ✓ DONE (2026-08-20 · generate:contracts/validate:contracts/typecheck/lint:ratchet/typecheck:tests:ratchet green; validate:python 234 passed; jest 2679 passed) |
| 7   | Downstream propagation: gemini-prompts + codex-prompts re-check adapters on next dep refresh; opencode-prompts needs the behavior ported explicitly (TS rewrite shares nothing) | ☐ (as of 2026-08-20 · flips when the next `synchronize-downstream-lock.js` run lands after this ships in a release)                                            |
