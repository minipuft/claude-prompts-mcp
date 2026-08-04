---
title: "Validation Surface Cleanup — Tier F5"
date: 2026-08-04
status: backlog
tags: []
---

# Validation Surface Cleanup — Tier F5

**Date**: 2026-08-04
**Area**: `.github/workflows/ci.yml`, `server/package.json`, two `server/scripts/validate-no-*.js` guards, `CLAUDE.md`
**Work type**: refactor (secondary: bug_fix — one registered check runs nowhere)
**Origin**: validation-surface audit 2026-08-04, prompted by "we have a lot that seem redundant at first glance"
**Confidence**: high on the findings — every count below is a probe result, and the one finding that
looked identical to the headline defect was re-checked and turned out to be correctly wired

---

## The defect

`verify:mcp` is registered at `server/package.json:65`, documented at `CLAUDE.md:82` as the way to
check a build, and **invoked by no workflow**. Two independent searches — the npm alias and the
script filename — return zero across `.github/workflows/`. Meanwhile `verify:mcp:self-test` runs
inside `validate:all` on every CI run.

So CI proves the MCP-surface verifier works, and never verifies the MCP surface. The three tools it
covers — `prompt_engine`, `resource_manager`, `system_control` — are the entire Public API Contract
per `CLAUDE.md`.

**A self-test proves the check runs; it does not run the check.** That is the whole finding.

### The near-miss that shaped the method

`validate:renovate-extraction` presented identically: self-test in `validate:all`, check absent from
every npm runner. It is **not** a defect — `renovate-config-validator.yml:67` invokes it with piped
stdin, which an npm-script grep cannot see. This tier therefore asserts "runs nowhere" only where
both the alias search and the filename search return nothing.

## What the audit found and rejected

The nine `no-X` guards look like the redundancy — 785 lines, eight at zero hits. They are not.
Each forbids something different, four guard patterns a developer would naturally write, and three
of the five migration tombstones already name a retirement condition in the form
`cleanup-standards.md` requires. Zero hits is what a working deterrent looks like.

**Non-goal**: deleting or merging guards on size grounds.

## Inventory (measured 2026-08-04 — re-measure before executing)

| Finding                                   | Evidence                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| `verify:mcp` runs nowhere                 | `rg -n "verify-mcp-surface\|verify:mcp" .github/workflows/` → 0                  |
| its self-test runs every CI run           | `server/package.json:131` inside `validate:all`                                  |
| `validate:full` referenced by no workflow | absent from `.github/workflows/`; one historical mention CLAUDE.md:28            |
| `validate:full` duplicates a step         | re-runs `lint:ratchet`, which `validate:all` runs first                          |
| `validate:metadata` is a bare alias       | `server/package.json:85` → `verify:action-metadata`                              |
| 2 of 9 guards lack a retirement condition | `rg -ci "retire\|once\|after"` → 0 for no-legacy-sidecars, no-prompt-gates-alias |
| verifier already has an RPC timeout       | `verify-mcp-surface.mjs:293` `AbortSignal.timeout` — no CI wrapper needed        |
| Build job already has the precedent step  | `ci.yml:285-287` "MCP tool schema snapshot", comment states the placement rule   |

## Subtiers

### Tier A — unblocked, touches no contested file

| #     | Status | Step                                                                               | Files                                           | Depends | Verification                                                               |
| ----- | ------ | ---------------------------------------------------------------------------------- | ----------------------------------------------- | ------- | -------------------------------------------------------------------------- |
| F5.1  | ☐      | Add "Verify MCP surface" step at `ci.yml:285-287`, beside the schema-snapshot step | `.github/workflows/ci.yml`                      | —       | Corrupt `dist/index.js` → `npm run verify:mcp` exits 1; rebuild → exits 0  |
| F5.3a | ☐      | Document a retirement condition on `no-legacy-sidecars`                            | `server/scripts/validate-no-legacy-sidecars.js` | —       | `rg -c -i "retirement condition" server/scripts/validate-no-*.js` → 8 of 9 |

**Tier A gate**: `validate:all` passes **and** a deliberately corrupted `dist/` makes `verify:mcp`
exit non-zero. Back-test, not re-run — the check must be shown to fail before it is trusted to pass.

### Tier B — blocked until `git status --short -- server/package.json` is empty

| #     | Status | Step                                                                                                   | Files                                                                     | Depends    | Verification                                                         |
| ----- | ------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------- |
| F5.2  | ☐      | Delete `validate:full`; rewrite `CLAUDE.md:28` so it keeps its history without naming a deleted script | `server/package.json`, `CLAUDE.md`                                        | file clear | `npm run validate:full` → missing script; `rg validate:full` → 0     |
| F5.4  | ☐      | Collapse the `validate:metadata` alias into `verify:action-metadata`                                   | `server/package.json`                                                     | file clear | `validate:all` passes; `rg validate:metadata` → 0                    |
| F5.3b | ☐      | Decide delete-vs-document for `no-prompt-gates-alias`                                                  | `server/scripts/validate-no-prompt-gates-alias.js`, `server/package.json` | file clear | If deleted: `rg no-prompt-gates-alias` → 0 and `validate:all` passes |

**Tier B gate**: `validate:all` passes, every deleted name returns zero `rg` hits, and every
surviving guard names a retirement condition.

Tier B is gated on a **git state**, not on Tier A. If the contested file clears first, it may start
independently.

## Decisions

| Decision                      | Chosen                                    | Rejected                        | Why                                                                                                                            |
| ----------------------------- | ----------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Where `verify:mcp` runs       | CI Build job, `ci.yml:285-287`            | `validate:all`; a dedicated job | Only the Build job has a fresh `dist/`, and the verifier refuses a stale one. A dedicated job doubles build time for one check |
| How to assert "runs nowhere"  | Two searches — npm alias **and** filename | Single npm-script grep          | `validate:renovate-extraction` passes the first and fails the second; it is invoked with piped stdin                           |
| `validate:full`               | Delete                                    | Keep and de-duplicate           | No workflow references it, and it re-runs `lint:ratchet` that `validate:all` already runs                                      |
| The two condition-less guards | Decide per guard                          | Blanket delete; blanket keep    | They differ in reintroducibility, not age — see below                                                                          |

**The two tombstones are not the same kind of thing.** `no-legacy-sidecars` forbids six path and
field patterns repo-wide; a developer could reintroduce a sidecar state file without ever typing a
retired symbol name, so the guard still earns its place and only needs its condition written down.
`no-prompt-gates-alias` forbids two exact expressions in one named file
(`prompt-lifecycle-processor.ts`) — reintroducing it means rewriting that specific coalescing
expression. That one is a genuine tombstone candidate.

## Risks

| Risk                                             | Impact | Mitigation                                                                                                  | Rollback               |
| ------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------- | ---------------------- |
| Staging `server/package.json` mid-session        | High   | Tier B gated on `git status --short` being empty for that path                                              | `git restore --staged` |
| `verify:mcp` is slow or flaky in CI              | Medium | Verifier already carries `AbortSignal.timeout` (:293); the job's other steps already spawn the built server | Remove the step        |
| Deleting a guard whose pattern is still writable | High   | F5.3b is scoped as a decision, not a deletion; the `head -12` evidence is recorded above                    | Restore from git       |

**No new files.** Every change edits something that exists.

## Documentation

| Doc            | Update                                                                           |
| -------------- | -------------------------------------------------------------------------------- |
| `CLAUDE.md:82` | The `verify:mcp` claim becomes true once F5.1 lands — no edit needed             |
| `CLAUDE.md:28` | F5.2 — rewrite so the sentence keeps its history without naming a deleted script |
| `CHANGELOG.md` | Fixed (verifier now runs) + Removed (`validate:full`, `validate:metadata` alias) |

## Release

`fix(ci)` for F5.1 · `chore(scripts)` for F5.2/F5.3/F5.4

## Growth capture

The `<check>` + `<check>:self-test` pair coming apart is now the **seventh** instance in two days of
a check whose referent was narrower than its claim — after a detector watching the wrong interface,
a detector resolving a structural alias, a gate reading compiled output instead of source, a
validator reading two parser tables as if they were all the flag sources, a grep matching one
phrasing of a claim rather than the claim, and `git status` used to answer a question only
`git log` can answer.

Past the 3-sighting bar by a wide margin. The pattern deserves a name and a home in
`refactoring.md`'s check semantics rather than another plan-file paragraph:

> **Referent narrower than claim.** A check names what it verifies; verify that the thing it reads
> is that thing. Ask what state would make this check wrong, then produce that state.

## Rejected alternatives

- **Merge or delete the nine `no-X` guards** — 785 lines across nine independent checks is not
  redundancy. Four guard patterns someone would naturally write, and zero hits is what a working
  deterrent looks like.
- **Add `verify:mcp` to `validate:all`** — `validate:all` does not build, and the verifier refuses a
  stale `dist/`. It would fail or pass vacuously depending on leftover state, which is the exact
  defect class this tier removes.
- **Fix `validate:renovate-extraction` too** — it is not broken. It is invoked from
  `renovate-config-validator.yml` with piped stdin.
- **Batch all subtiers into one commit** — three of five edit a file another session holds
  uncommitted; staging it would commit their work.

---

## Note on this plan's own procedure

`>>implementation_plan` Phase 4-6 instructs writing the assembled plan to `~/.claude/plans/`. It
went here instead: this repo's convention is that plans live in the repo they describe, versioned
and reviewed with the code, with `~/knowledge-hub` mounting them by symlink. A prior initiative's
`~/.claude/plans/` file is already recorded as lost. The prompt instruction is stale against the
convention.

Two phase guards also disagreed with their own prompt body during this run: Phase 2.5 documents
`## context_establishment` / `## systematic_analysis` / `## goal_definition` as the enforced
sections, but the guard asked for `## Context` / `## Analysis` / `## Goals`; Phase 3 then asked for
`## Execution`, which its RESULT template does not mention. Both were satisfiable by emitting both
header sets, but the prompt and its guard should agree — that is the same defect class this tier
exists to fix, one layer up.
