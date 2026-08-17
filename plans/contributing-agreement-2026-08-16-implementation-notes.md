---
title: "CONTRIBUTING agreement — implementation notes"
date: 2026-08-16
status: done
tags:
  - docs
  - scripts
  - ci
---

# Implementation Notes

Plan: [`contributing-agreement-2026-08-16.md`](./contributing-agreement-2026-08-16.md)

## Rulings

### OQ-2 — RULED: the validator must run on the docs CI route, and must be dependency-free

**Question**: is `validate:contributing` reachable on the `docs` CI route?

**Answer: no, not as the plan wrote it.** Measured, not inferred:

- `scripts/classify-validation-scope.js:13` lists `CONTRIBUTING.md` as a docs-scope path.
- `.github/workflows/ci.yml:158` runs `npm run validate:all` only when `scope == 'full'`.
- On `docs` scope the Lint & Validate job reaches "Confirm lightweight validation" and echoes a
  pass. No document content is checked.

So a CONTRIBUTING-only PR classifies as `docs`, skips `validate:all`, and the new gate never fires.
Registering it in `run-validation-suite.js` alone would ship a gate that is dead on exactly the PRs
it exists to police. This is the same shape as the `verify:mcp` blind spot (a gate that could not
observe its own subject) and as the prompt-binding defect itself.

**Consequences, both binding on Tier 2:**

1. A CI step must run the validator when `scope == 'docs'`, in addition to its membership in
   `validate:all` for `scope == 'full'`.
2. `ci.yml` guards "Setup Node.js" and "Install dependencies" on `scope != 'docs'` and
   `scope == 'full'` respectively, so **no `node_modules` exists on the docs route**. The validator
   must therefore use zero npm dependencies and only `node:` builtins. The runner image ships Node,
   so a dependency-free script runs without setup.

This inverts the usual direction of the CLAUDE.md rule. The rule says a hook step must exist in
`validate:all` first, which CI runs whole. That holds. The addition here is that `validate:all` is
not "whole" on every route, so route coverage is a separate question from suite membership.

### OQ-1 — RULED: `typecheck:tests:ratchet` does not join pre-push

Document it in CONTRIBUTING's Minimum Validation, leave `.husky/pre-push` alone.

- It is already in `validate:all` at `run-validation-suite.js:78`, so CI catches it.
- `pre-push` already runs 8 steps including `typecheck:committed`.
- The failure class is caught late rather than missed, and pre-push latency is paid on every push.

Revisit if a tests-ratchet failure ever reaches `main`, which would move it from late to missed.

## Deviations

### DEV-T2-1 — validator scope narrowed to command existence only

The plan's Tier 2 already declared gate-sequence checking out of scope for v1. Restating here
because OQ-2 adds a second reason: a dependency-free script cannot import the project's YAML or TS
tooling, so any check needing to parse `run-validation-suite.js` semantics is out of reach on the
docs route regardless of appetite.

### DEV-T3-1 — `ci.yml` edited, which the plan did not list in scope

The plan's scope named `CONTRIBUTING.md`, the new script, `package.json`, and
`run-validation-suite.js`. OQ-2 forces a fifth file, `.github/workflows/ci.yml`. Taken as
in-intent rather than scope creep, since the plan's acceptance criteria require the gate to catch
its motivating instance and it cannot do that without the route step.

## Discovered Unknowns

None open.
