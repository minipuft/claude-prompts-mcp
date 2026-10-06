---
number: 0004
title: "A plan ruling a consumer can observe becomes an ADR in the pull request that ships it"
status: accepted
date: 2026-09-28
initiative: delivery-contract
supersedes:
superseded_by:
---

# ADR 0004: A plan ruling a consumer can observe becomes an ADR in the pull request that ships it

## Context

Rulings lived in plan files (A1–A7, B17–B22 style tables) that are archived when the plan retires,
in a different repository from the code they constrain; this directory held one ADR in two months
while dozens of rulings shipped.

## Decision

At the PR boundary, any ruling a consumer can observe, or that changes a default, is written as an
ADR here in the same PR (`node scripts/adr.mjs new "<title>" --initiative <slug>`), and the plan row
points at it. Test: would a reader who followed the old behavior now do the wrong thing? Yes: a new
ADR (and `supersede` for the one it replaces). No: amend the existing ADR in place with a dated
section. A superseded ADR keeps its number and file; only its status changes. ADRs never live in
the config repository.

## Consequences

The decision log grows with the code; the plan stays the work ledger; the index is generated
(`adr.mjs index`) and `adr.mjs check` fails when it is stale.
