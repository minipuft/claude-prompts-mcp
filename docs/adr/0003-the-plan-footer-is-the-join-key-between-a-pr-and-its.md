---
number: 0003
title: "The Plan footer is the join key between a PR and its initiative"
status: accepted
date: 2026-10-06
initiative: delivery-contract
supersedes:
superseded_by:
---

# ADR 0003: The Plan footer is the join key between a PR and its initiative

## Context

21 consecutive merged PRs (#393–#413, 2026-09-24 to 09-27) belonged to one initiative, and nothing
in `main`'s history joined them. Titles were already outcome-named; the arc itself was invisible.

A first answer (2026-09-28) added a second trailer, `Initiative: <plan slug>`, beside the `Plan:`
footer. It duplicated information the footer already carries: the slug is a pure function of the
plan path. The shared delivery contract retired that trailer on 2026-10-06 (repository-standards
v1.9.0), before any PR on `main` had carried one.

## Decision

The `Plan:` footer is the join key between a PR and its initiative, and it stays the only plan
mention a PR body makes. Every PR in a multi-PR initiative names its plan in that footer, so the
squash bodies on `main` join with `git log --grep='Plan: .*<slug>'`. A `Decision: ADR-NNNN` trailer
names an ADR the PR adds or changes, one trailer per ADR.

`scripts/pr-body.mjs` emits both lines; `scripts/validate-pr-body.mjs` fails a `Decision:` trailer
naming an ADR number with no file under `docs/adr/`, and ignores an `Initiative:` trailer left in an
older body. Both scripts are managed by the delivery contract (`.delivery-contract.json`), not
edited here.

## Consequences

An arc is one command over `main`. A slug is derived from the plan filename, never registered. A
`Decision:` trailer is checked the same way the `Plan:` footer's existence is, so neither can name
something that is not in the tree.
