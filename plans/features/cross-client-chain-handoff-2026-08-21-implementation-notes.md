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

- **DEV-T1-1** 2026-08-21: The plan's transfer model ("claim rewrites run_owner_pid") collided
  with how `save()` persists — delete-all-rows-for-owner then INSERT with `session_id` as PRIMARY
  KEY. After a claim the donor's in-memory copy would re-INSERT the claimed row and take the
  donor's whole persist down. Added: `save()` now returns the ids it skipped because another owner
  holds the row (`findRunsOwnedByOthers`), and `ChainSessionStore.evictClaimedSessions` drops
  them from memory before the hook projection runs. The donor learns of the claim at its next
  persist; anything it advanced in between is lost by design (the handoff was explicit).
- **DEV-T1-2** 2026-08-21: `ClaimRunResult` was first declared in `modules/chains/run-registry.ts`,
  but `ChainSessionService` (the executor's dependency seam) lives in `shared/types`, which must not
  import from `modules/`. The result union moved to `shared/types/chain-session.ts` as
  `ChainHandoffClaimResult` (with the store-level `no-blueprint` arm); the registry's
  `ClaimRunResult` is the `Exclude` of that.
- **DEV-T1-3** 2026-08-21: Token encoding is base64url (`hnd_` + 20 random bytes), not the base32
  the OQ-4 ruling wrote — Node's `Buffer` has no base32 and the property that matters (unguessable,
  shell/URL safe) holds either way. Plan text corrected in place.
- **DEV-T1-4** 2026-08-21: `claim_token` does not answer with a "claimed" message and stop; it
  transfers and then FALLS THROUGH as a plain `chain_id` resume in the same call, so the claimer
  receives the current step immediately and its PostToolUse tracker records the chain from the
  rendered response — which is what makes the plan's "hook adoption needs no hook changes"
  decision actually hold. `getSessionByChainIdentifier` promotes the dormant claimed run to
  canonical on that resume, as it does for every persisted run.
- **DEV-T1-5** 2026-08-21: `chain-session-hook-projection.test.ts`'s `InMemoryRunRegistry`
  implemented the old `save(): Promise<void>`; under the new contract `evictClaimedSessions`
  iterated `undefined` inside the persist transaction and rolled every projection back — 12
  unrelated tests red from one interface change. Stub updated to the new contract
  (`save → []`, `claimRunByToken → unknown-token`).
- **DEV-T1-6** 2026-08-21 — the `reached` probe caught a dead path: with typecheck, lint, arch,
  and 2727 unit tests green, the two-server live drive showed `handoff:true` rendering the
  prompt and `claim_token` alone answering "missing command". `src/mcp/tools/index.ts`
  hand-builds the executor's argument object as an explicit ALLOWLIST, whose own comment
  records three prior instances of exactly this; both verbs are now listed (fourth instance,
  recorded in the comment). The drive is promoted to `server/scripts/verify-handoff.mjs`.
- **DEV-T1-7** 2026-08-21: `export-template-compile.test.ts` (parity commit) imported a
  non-exported `SkillIR` and built a fixture missing newer fields; the tests-typecheck ratchet
  flagged it only now. `SkillIR` is exported and the fixture completed — attributed to the
  parity workstream, fixed here because a gate nobody can pass blocks every future tier.

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

- **Concurrent first boot locks the db**: two fresh servers initializing the same empty
  `state.db` at the same instant fail with `database is locked` (ResourceChangeTracker init).
  Real servers start at different times, so the drive starts them sequentially; still a gap
  for any launcher that spawns two clients' servers at once (row candidate for the sqlite
  remediation plan, not 2A).
