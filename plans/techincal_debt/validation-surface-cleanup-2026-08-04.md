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

| Finding                                             | Evidence                                                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `verify:mcp` runs nowhere                           | `rg -n "verify-mcp-surface\|verify:mcp" .github/workflows/` → 0                                                                   |
| its self-test runs every CI run                     | `server/package.json:131` inside `validate:all`                                                                                   |
| `validate:full` referenced by no workflow           | absent from `.github/workflows/`; one historical mention CLAUDE.md:28                                                             |
| `validate:full` duplicates a step                   | re-runs `lint:ratchet`, which `validate:all` runs first                                                                           |
| `validate:metadata` is a bare alias                 | `server/package.json:85` → `verify:action-metadata`                                                                               |
| ~~2~~ **3** of 9 guards lack a retirement condition | corrected at execution — `rg -ci "retirement condition"` across **all nine** also returns 0 for `no-tool-layer-validator-imports` |
| verifier already has an RPC timeout                 | `verify-mcp-surface.mjs:293` `AbortSignal.timeout` — no CI wrapper needed                                                         |
| Build job already has the precedent step            | `ci.yml:285-287` "MCP tool schema snapshot", comment states the placement rule                                                    |

## Subtiers

### Tier A — unblocked, touches no contested file

| #     | Status | Step                                                                                              | Files                                                                                                         | Depends | Verification                                                               |
| ----- | ------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------- |
| F5.1  | ✓      | Add "Verify MCP surface" step at `ci.yml:285-287`, beside the schema-snapshot step                | `.github/workflows/ci.yml`                                                                                    | —       | Corrupt `dist/index.js` → `npm run verify:mcp` exits 1; rebuild → exits 0  |
| F5.3a | ✓      | Document a retirement condition on `no-legacy-sidecars` **and `no-tool-layer-validator-imports`** | `server/scripts/validate-no-legacy-sidecars.js`, `server/scripts/validate-no-tool-layer-validator-imports.js` | —       | `rg -c -i "retirement condition" server/scripts/validate-no-*.js` → 8 of 9 |

**Tier A gate**: `validate:all` passes **and** a deliberately corrupted `dist/` makes `verify:mcp`
exit non-zero. Back-test, not re-run — the check must be shown to fail before it is trusted to pass.

### Tier B — blocked until `git status --short -- server/package.json` is empty

| #     | Status | Step                                                                                                   | Files                                              | Depends    | Verification                                                     |
| ----- | ------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ---------- | ---------------------------------------------------------------- |
| F5.2  | ✓      | Delete `validate:full`; rewrite `CLAUDE.md:28` so it keeps its history without naming a deleted script | `server/package.json`, `CLAUDE.md`                 | file clear | `npm run validate:full` → missing script; `rg validate:full` → 0 |
| F5.4  | ✓      | Collapse the `validate:metadata` alias into `verify:action-metadata`                                   | `server/package.json`, `.github/workflows/ci.yml`  | file clear | `validate:all` passes; `rg validate:metadata` → 0 in live config |
| F5.3b | ✓      | Decide delete-vs-document for `no-prompt-gates-alias` → **documented**                                 | `server/scripts/validate-no-prompt-gates-alias.js` | file clear | 9 of 9 guards carry a retirement condition                       |

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

## Execution notes — Tier A (2026-08-04)

### The re-measure caught this plan measuring its own pre-selected sample

The inventory asserted "2 of 9 guards lack a retirement condition." Running the grep across **all
nine** returns three: `no-legacy-sidecars`, `no-prompt-gates-alias`, and
`no-tool-layer-validator-imports`. The third was never a candidate because the audit ran its check
only on the two guards it had already classified as tombstones — the population was never measured,
only the sample that had already been concluded about.

F5.3a therefore covers two guards rather than one. Justified scope growth: same class (standing
architectural constraint, documented rather than deleted), same file type, no contested file, found
by the tier's own mandated re-measure. The alternative — fixing one of three and leaving a known
gap — is worse than the growth.

`no-tool-layer-validator-imports` got a retirement condition naming its own weakness: it carries a
literal list of six module paths, so renaming any one silently empties the guard while leaving it
green. It retires when `validate:arch` expresses the edge as a dependency-cruiser layer rule, which
follows renames.

### One Verification command was vacuous and was substituted

The plan's F5.1 row cited `npm run validate:release-workflow`. That script reads
`.github/workflows/extension-publish.yml` — it cannot observe `ci.yml`, so its green result was
evidence about nothing here. Substituted with a real YAML parse of `ci.yml` plus a structural
read-back confirming the step exists in `jobs.build.steps[9]`, runs `npm run verify:mcp`, and
carries the same `needs.classify.outputs.scope == 'full'` guard as its siblings.

`validate:github-action-pins` was checked for scope before being trusted: it walks
`.github/workflows`, so it does observe the change.

### Criteria and back-test

Five criteria, all mapped. F5.1's row names two behaviours, so it is two criteria, not one:

| #   | Criterion                                               | Result                                 |
| --- | ------------------------------------------------------- | -------------------------------------- |
| 1   | `verify:mcp` exits non-zero against a corrupted `dist/` | exit 1 — "FAILED: 2/3 checks passed"   |
| 2   | `verify:mcp` exits zero against a fresh `dist/`         | exit 0 — "OK: 12/12 checks passed"     |
| 3   | `ci.yml` is valid YAML with pinned actions              | parses; 7 jobs; action-pins passes     |
| 4   | Step sits in the Build job under the sibling guard      | `jobs.build.steps[9]`, guard identical |
| 5   | Guards carrying the exact phrase                        | 8 of 9 (9th is F5.3b, Tier B)          |

`all_criteria_mapped: yes`. Criterion 1 is the one that matters — the step was only trusted to pass
after being shown to fail.

### Suite state

typecheck, `lint:ratchet`, `typecheck:tests:ratchet`, and 1915 tests pass. `validate:all` remains
red at two points, neither from this tier and both belonging to a concurrent session:
`validate:format` (four uncommitted deletions still in the `git ls-files` glob) and
`validate:no-methodology-vocab` (one comment in `server/src/mcp/tools/index.ts`, which that session
holds modified — editing it would fold their work into this commit).

Tier B remains blocked: `server/package.json` is still ` M`, now at version 3.1.2.

## Execution notes — Tier B (2026-08-04)

### F5.3b's premise was backwards, and the evidence was one grep away

The plan called `no-prompt-gates-alias` "a genuine tombstone candidate," reasoning that
reintroducing the defect "requires rewriting that specific coalescing expression." The guard's own
target file contains, at line 121:

```ts
gateConfiguration: args['gate_configuration'],
```

That is the exact left-hand side of the first forbidden pattern. The forbidden form is
`gateConfiguration: args['gate_configuration'] || args.gates` — so reintroducing it means appending
five tokens to a line that already exists, in the file the guard watches. Both spellings are still
live in the surface: `gate_configuration` in `resource-manager.schema.ts`, `args.gates` in three
tool-layer files.

**It is the most reachable guard of the nine, not the least.** The plan reached the opposite
conclusion by reading the guard's regex and judging the expression exotic, without checking whether
its left-hand side was already sitting in the target. Resolved to _document_, with a retirement
condition naming the two spellings whose disappearance would make the expression unwritable.

That is the third plan premise this tier corrected at execution — after the guard count (2 vs 3)
and the vacuous verification command in Tier A. Each was found by the mandated re-measure, and
none would have been found by re-reading the plan.

### F5.4 had two consumers the plan did not list

`rg` found `validate:metadata` in `.github/workflows/ci.yml:153` (a comment enumerating what a job
covers) and `docs/TODO.md:113` (a completed `[x]` checklist item). The plan's Files column named
only `server/package.json`.

The ci.yml comment describes current behaviour, so it was updated. **`docs/TODO.md` was
deliberately left alone**: it is a historical record of a task completed under the old name, and
rewriting it would falsify what was actually done — the same exemption `cleanup-standards.md`
grants CHANGELOG.md. `rg validate:metadata` therefore returns one hit by design, not by oversight.

### Editing the contested file

`server/package.json` was still held modified by a concurrent session (mid-rebrand — its
description now reads "Wolfflow: …"). The operator authorised proceeding and will separate the
commits.

The `validate:all` entry was rewritten with `JSON.parse` → mutate → `JSON.stringify`, which
reserialises the whole file. Verified afterwards that the other session's content survived intact:
description, the 7-entry `files` array, the 14-entry `keywords` array, and 111 scripts all present,
and `prettier --check` clean. The diff against HEAD contains exactly three deletions of mine.

### Criteria

| #   | Criterion                                  | Result                                                  |
| --- | ------------------------------------------ | ------------------------------------------------------- |
| 1   | `npm run validate:full` no longer resolves | `npm error Missing script: "validate:full"`             |
| 2   | No live `validate:full` reference          | 0 across CLAUDE.md, docs/, .github/, package.json       |
| 3   | `validate:all` still passes its members    | all green except the two foreign failures               |
| 4   | `validate:metadata` gone from live config  | 0 in package.json and workflows; 1 in TODO.md by design |
| 5   | Every guard names a retirement condition   | **9 of 9**                                              |

`all_criteria_mapped: yes`. typecheck, `lint:ratchet`, `typecheck:tests:ratchet`, and 1915 tests
pass. `validate:all` remains red at the same two foreign points as Tier A —
`validate:format` (four uncommitted deletions in the `git ls-files` glob) and
`validate:no-methodology-vocab` (one comment in `server/src/mcp/tools/index.ts`, held modified by
the other session).

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
