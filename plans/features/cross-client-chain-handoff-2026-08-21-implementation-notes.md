---
title: "Cross-Client Chain Handoff (2A) — Implementation Notes"
plan: cross-client-chain-handoff-2026-08-21.md
date: 2026-08-21
status: active
tags: []
---

# Implementation Notes

Deviations, discovered constraints, unknowns, and re-measurements found while
executing the plan. Conservative option taken, logged, work continued.

## Deviations

## T0 Measurements (2026-08-21)

- **Blueprint presence**: 7/7 live runs in the shared `server/runtime-state/state.db`
  carry `blueprint` in their residual document — both `working` and `completed`,
  spanning `implementation_plan` and `strategicImplement` shapes. Absence remains
  possible by construction (`options?.blueprint` optional at `manager.ts:557`) and is
  already refused at `manager.ts:2347`; the claim verb reuses that refusal.
- **chain_id collisions are real, not theoretical**: run numbering is a per-server
  sequence. `chain-strategicImplement#1` existed simultaneously as an OpenCode-owned
  `working` run in the shared db and as this Claude session's completed run in its own
  db. OQ-4 (claim identity must be stronger than chain_id) is grounded in this.
- **Three dbs observed on this machine**, not two: `<repo>/runtime-state/` (repo-root
  MCP_WORKSPACE servers), `<repo>/server/runtime-state/` (server-suffixed
  MCP_WORKSPACE: OpenCode npx + systemd HTTP), and the Claude plugin session's own
  workspace db (this session's runs appear in neither repo db). Handoff across dbs is
  NOT solved by a token — the claimer must read the donor's db file. v1 scope should
  state this: claim works within one shared db; cross-db handoff is out of scope.

## Unknowns / gaps found during execution
