---
title: "Generated operator facts: stop hand-maintaining derivable claims in CLAUDE.md"
date: 2026-08-25
status: backlog
tags: [tooling, documentation, contracts]
---

# Generated Operator Facts

## Why this exists

Raised by the owner during the 2026-08-25 security review, after the review kept finding
that **the handbook was wrong about things a script could have measured**.

Measured that day, before any of this was designed:

| Claim class in `CLAUDE.md`                                | Drift                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| Command names (15 named, 158 scripts exist)               | **0** — hand-maintenance holds fine here                    |
| `system_control` action handlers                          | documented **11**, on disk **12** (`skills_sync` unlisted)  |
| "the server does not execute shell commands"              | false from the first `shell_verify` gate (finding C5)       |
| "`kv_state` is the only table that writes `workspace_id`" | false — three other tables write it (finding C16)           |
| "rollback history is shared across every project"         | false — `version_history` filters `tenant_id` (finding C16) |

The pattern: **CLAUDE.md is accurate about what is cheap to check and wrong about what
requires a measurement.** Generation should own the second class. It must NOT own the first
class of value in that file — the rulings and rationale (why `--check` not `--write`, why
`lint:ratchet` is not at pre-commit, the R1 posture ruling) are judgment and cannot be derived.

## Owner rulings (2026-08-25)

| #    | Ruling                                                                                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OR-1 | **Placement: both.** A generated file is canonical; a short digest of load-bearing numbers is inlined in `CLAUDE.md`. The gate must cover the inlined digest too, or it becomes the next thing that drifts. |
| OR-2 | **Ownership: here first, upstream once proven.** `repository-standards` is the fleet upstream, but the contract should be measured against real drift here before it is promoted.                           |
| OR-3 | **Routing: its own plan.** Tier 5 of the security review is capture (security prompt + skill); this is tooling architecture with different motivation. Security review closes first.                        |
| OR-4 | **Scope: open** — the owner asked whether semantic maps can be generated _reliably_, rather than picking a tier. Answered below.                                                                            |

## OR-4 — can semantic maps be generated reliably?

**For the classes this repo already models: yes, and the machinery exists.** This is not a
novel inference problem.

`src/infra/database/table-contracts.ts` already declares `readers: readonly string[]` per
table, and `scripts/validate-table-contracts.ts` already enforces it:

- `checkReaders` fails when `readers` is empty and no `finding` is declared — _"A table
  written and never read is a missing consumer or a redundant channel — decide which"_;
- every declared reader path must exist on disk;
- `validate-no-phantom-columns.ts` covers the inverse (a field with readers and no writer).

So the C16 class was never a missing capability. The data was declared, gate-verified, and
correct; the **prose summary of it** in `CLAUDE.md` drifted. Generating that section from the
contract is reading a declared value, not inferring from an AST.

**The real gap is granularity, not technique.** The contract models read/write symmetry at
TABLE level. Finding C17 is at COLUMN level: `workspace_id` is written by four tables and read
by zero queries, and nothing checks that. Extending the existing phantom-column checker to
per-column symmetry is a bounded problem on machinery that already parses these statements.

**What NOT to build**: open-ended semantic inference over the codebase. A confidently-wrong
generated table is worse than prose, because prose is read skeptically and a generated table
is not. Every probe must state which property it measures — the C6 mis-count (all `*.yaml`
under `resources/gates` vs actual gate definitions) is the worked example of a probe that
answered a different question and nearly manufactured a false correction to a correct claim.

**`>>tech_recommendation` was not run**: it is referenced by the global rules but **is not in
this server's catalog** (measured 2026-08-25 — nearest installed are `investigate_unknown`,
`deep_analysis`, `triage`). A technique survey was judged unwarranted once the answer resolved
to "extend machinery that already exists" rather than "choose among novel techniques". Revisit
if the scope widens past declared contracts.

## Tiers

### Tier 1 — Generate what is already declared

| #   | St  | Work                                                                                                                                                                                                                      | Verify                                                                     |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1.1 | ☐   | (as of 2026-08-25 · flips when the generated file exists and a gate fails on drift) Emit `docs/reference/operator-facts.md` from `package.json` scripts, `.husky/*`, `ci.yml`, prettier configs, and `table-contracts.ts` | Gate mirrors `validate:agent-guidance`: regenerate, diff, fail on mismatch |
| 1.2 | ☐   | (as of 2026-08-25 · flips when the digest is gate-covered) Inline a short digest in `CLAUDE.md` per OR-1                                                                                                                  | The gate checks the digest, not just the canonical file                    |
| 1.3 | ☐   | (as of 2026-08-25 · flips when CLAUDE.md no longer restates a generated number) Strip the now-duplicated facts from `CLAUDE.md`, keeping rulings                                                                          | No countable claim appears in both places unchecked                        |

### Tier 2 — Close the granularity gap

| #   | St  | Work                                                                                                                                       | Verify                                                           |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 2.1 | ☐   | (as of 2026-08-25 · flips when the checker reports `workspace_id` unread) Extend phantom-column checking to per-COLUMN read/write symmetry | Must catch C17 — its own motivating instance — or it is not done |

### Tier 3 — Upstream (per OR-2)

| #   | St  | Work                                                                                                                          | Verify                                                    |
| --- | --- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 3.1 | ☐   | (as of 2026-08-25 · flips when a second fleet repo consumes the generator) Promote to `repository-standards` once proven here | Contract measured against ≥2 repos, not designed from one |

## Note on the cache argument

The owner also proposed batching handbook updates to release, to avoid invalidating the
session-start cache. Not adopted, and the reasoning is worth keeping: the two most expensive
documentation defects this review found (C5, C16) were **staleness**, so deliberately widening
the staleness window trades correctness for tokens. A CLAUDE.md edit invalidates the prefix
once, for sessions started afterward — it only churns if CLAUDE.md churns, and the cure for
churn is generation, not delay. OR-1's split delivers the same cache stability as a side
effect: rulings change rarely, facts regenerate into a file that is not read at session start.
