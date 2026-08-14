---
title: "Validation Harness Consolidation"
date: 2026-08-11
status: reference
tags: []
---

# Validation Harness Consolidation

**Date**: 2026-08-11
**Branch**: `release-3.1.0-final`
**Work type**: refactor (secondary: optimize)
**Status**: **COMPLETE 2026-08-11.** All three opening premises REFUTED by measurement; Tier 1
closed without implementation (already done concurrently by `a5d8cb51`); **Tier 2 executed — net
−141 LOC, `validate:all` 34 → 33 members, coverage proven equal on all four self-test cases.**

---

## Executive summary

This plan was opened to consolidate a validation harness judged excessive — 34 `validate:all`
members, bespoke grep guards, and a meta-layer auditing their allowlists. **Discovery falsified
every premise it rested on before any edit was made**, which is the plan's most useful output.
The harness is not the defect; the reasoning about it was.

| Premise as briefed                                                | Measured                                                       | Verdict     |
| ----------------------------------------------------------------- | -------------------------------------------------------------- | ----------- |
| "15 hand-rolled `no-*` grep guards"                               | **6** guards (9 npm entries incl. 3 `:self-test`)              | **REFUTED** |
| "Pure token-bans should migrate to ESLint `no-restricted-syntax`" | **All 6 already document why ESLint cannot reach their scope** | **REFUTED** |
| "`.husky/pre-commit` exceeds the project's own <10s budget"       | **4.4 s** floor — the 29 s was a component sum from stale docs | **REFUTED** |

The "15" came from this plan's sibling — the shim-debt sweep's Tier V prose, quoted forward without
re-measurement. That is the **Untrusted Inventory** diagnosis recurring in the argument written to
justify a new plan. Logged here rather than quietly corrected, because the pattern is the reusable
part.

---

## Measured baseline (2026-08-11)

| Measure                               | Value                     | Probe                                                                                                      |
| ------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `validate:*` / `verify:*` npm scripts | **58**                    | `package.json` scripts, `/^(validate\|verify):/`                                                           |
| Guard script files                    | **29**                    | `fd -e js -e ts -e mjs 'validate-\|verify-' scripts -d 1`                                                  |
| Bespoke validation LOC                | **6,696**                 | `wc -l` over those 29                                                                                      |
| `scripts/lib/` shared helpers         | 164 (`exception-hygiene`) | `fd . scripts/lib`                                                                                         |
| `validate:all` members                | 34                        | `run-validation-suite.js` `SUITE`                                                                          |
| `validate:all` wall clock             | 58–76 s                   | suite runner's own per-step timing                                                                         |
| `validate:no-*` guards                | **6**                     | `validate-no-{legacy-sidecars,stepstate,methodology-vocab,llm-client,crosslayer-relative,phantom-columns}` |
| Combined LOC of those 6               | 1,201                     | `wc -l`                                                                                                    |
| `typecheck`                           | 4,639 ms                  | timed directly                                                                                             |
| `lint:ratchet`                        | 24,369 ms                 | timed directly                                                                                             |
| `validate:python` (conditional)       | 16,378 ms                 | suite runner                                                                                               |

---

## Finding 1 — the guard-to-ESLint migration is REFUTED, and would have narrowed coverage

Every one of the 6 guards carries a `MECHANISM:` annotation in its own header stating why a
standard linter cannot express it. Someone already asked this plan's question and answered it
per-guard:

| Guard                    | LOC | Documented reason ESLint/tsc cannot express it                                                                        |
| ------------------------ | --- | --------------------------------------------------------------------------------------------------------------------- |
| `no-legacy-sidecars`     | 52  | scans `../cli/src`, `../hooks`, `../docs/guides`, `../docs/reference` — **all outside the ESLint root**               |
| `no-stepstate`           | 66  | scans `tests/` as well as `src/`, and **ESLint globally ignores `tests/`** — "an AST port would silently halve scope" |
| `no-methodology-vocab`   | 406 | ripgreps every git-tracked file including `.md`, `.json`, `.yaml` under `resources/` — **no linter parses these**     |
| `no-llm-client`          | 279 | scans `../cli/src` alongside `src/` — outside the ESLint root                                                         |
| `no-crosslayer-relative` | 169 | decides layer crossing from the **resolved** path; a textual `../../*` ban measured **197 false positives, 0 real**   |
| `no-phantom-columns`     | 229 | SQL schema columns vs their writers — not expressible in any JS linter                                                |

**The migration would have been a silent coverage regression**, which the `no-stepstate` header
predicts verbatim. The reason these are scripts is _reach_, not ignorance of ESLint — and reach is
exactly the property `cleanup-standards.md` says an inert exemption exploits.

> **One candidate survives, unverified.** `no-crosslayer-relative` decides from resolved paths,
> which is what `dependency-cruiser` does natively and `validate:arch` already runs. Whether
> depcruise can express _this specific_ rule is **not established** — do not assume it from the
> shape. See row 2.1.

---

## Finding 2 — the real cost is meta-drift, and it is not fixed by deleting guards

The concern that opened this plan was maintenance and conflict surface. Both are real, but the
evidenced failures are not about guard _count_:

| Evidenced failure                                                                                  | Source                |
| -------------------------------------------------------------------------------------------------- | --------------------- |
| `validate:metadata` returned before reading anything — **inert through two refactors**             | shim-debt Tier V      |
| `validate-no-methodology-vocab` was **RED at HEAD, undetected**, after row 0.8 widened its scan    | shim-debt 5.7, D10    |
| An allowlist entry's retirement condition named a fold it did not document                         | shim-debt 5.7, D11    |
| `git checkout --` on directories destroyed 447 lines of a concurrent session's uncommitted work    | shim-debt Deviation 8 |
| Allowlists are **shared mutable, append-heavy files**; the tree routinely carries 100+ dirty paths | measured this session |

Deleting a guard removes its allowlist and therefore its conflict surface — but the guards that
would be deleted are the ones we just proved must stay. **The conflict surface is a cost of the
coverage, not of redundancy.**

> **Explicitly rejected: a `reviewAfter` / expiry stamp.** Proposed and withdrawn 2026-08-11. It
> adds a _third_ meta-layer above `exception-hygiene`, and of 11 distinct retirement conditions
> measured across the 4 gates that declare them, only ~2 are machine-decidable — 3 are deliberately
> permanent, 2 self-enforcing, 4 pure judgement. Machinery for two entries. Do not re-propose.

---

## Finding 3 — pre-commit is ~3× its own stated budget (CONFIRMED)

`ci-release.md` sets **pre-commit <10 s**. Measured floor, before `lint-staged` and excluding the
conditional Python step:

| Step                                        | Measured  |
| ------------------------------------------- | --------- |
| `typecheck`                                 | 4,639 ms  |
| `lint:ratchet`                              | 24,369 ms |
| **floor**                                   | **~29 s** |
| + `validate:python` when `hooks/` is staged | **~45 s** |

`lint:ratchet` is **84 %** of the floor. This is the one place where the harness measurably departs
from a standard the project itself set, and the fix does not remove any coverage — it moves a
whole-project scan off the per-commit path, where a staged-file scan already runs.

---

## Phase 3 — Implementation table

### Tier 1: Bring pre-commit inside its stated budget. — CLOSED 2026-08-11, premise falsified.

> **This tier was already implemented before it was written.** Commit `a5d8cb51`
> ("chore(ci): scope pre-commit by changed paths and stop duplicating the lint ratchet") landed
> **2026-08-11 21:59**, fifteen minutes after `05b6efcb` and while this plan was being authored —
> by a concurrent session, with reasoning that matches row 1.1 and is better stated than mine.

| ID  | Status | Step                                                                                                                                                                                                                                                                              | Files                                  | Depends | Verification                                                                              |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| 1.0 | ✓      | Time `.husky/pre-commit` end to end rather than summing its parts. **This row is what saved the tier** — the sum was taken from stale docs; reading the hook falsified rows 1.1-1.3                                                                                               | (measurement only)                     | —       | **DONE** — floor is `typecheck` alone, measured **4,428 ms**, inside the <10s budget      |
| 1.1 | ⊘      | **ALREADY DONE by `a5d8cb51`.** `lint:ratchet` no longer runs at pre-commit; the hook carries an explicit comment saying so. Original step: move `lint:ratchet` from `pre-commit` to `pre-push`                                                                                   | `.husky/pre-commit`, `.husky/pre-push` | 1.0     | `rg "ratchet" .husky/pre-commit` → only the explanatory comment, no invocation            |
| 1.2 | ⊘      | **ALREADY SATISFIED.** `typecheck` is retained and the hook documents 6.1s measured against the <10s budget; re-measured here at 4.4s. Original step: re-check `typecheck` against the budget                                                                                     | `.husky/pre-commit`                    | 1.1     | Pre-commit floor 4.4s with typecheck retained                                             |
| 1.3 | ⊘      | **MOOT for this tier** — there is no new boundary to verify, the boundary moved in `a5d8cb51`. Its coverage claim is verified instead: `pre-push` invokes `lint:ratchet` (step 2/8) and CI runs `validate:all` whole. Original step: negative-verify the new boundary             | (verification only)                    | 1.2     | `rg -c "lint:ratchet" .husky/pre-push` → 1; ratchet remains a `validate:all` member       |
| 1.4 | ✓      | **NEW — the defect that produced this tier's false premise.** `CLAUDE.md` §Validation Gates still named `lint-ratchet` as a pre-commit member after `a5d8cb51` removed it. Docs/Code Lockstep is Core Principle #4, and this is the stale line I read instead of reading the hook | `CLAUDE.md`                            | 1.0     | **DONE** — the sentence now excludes lint-ratchet and states why, with the measured floor |

**Gate**: ~~pre-commit measured <10s end to end~~ — **met, but not by this tier.** Pre-commit floor
is 4.4s; `validate:all` unchanged; coverage preserved at pre-push and CI. Nothing in Tier 1
remained to implement except 1.4.

#### Tier 1 execution record (2026-08-11)

**Finding 3 of this plan is RETRACTED.** It claimed pre-commit runs ~29s (`typecheck` 4.6s +
`lint:ratchet` 24.4s). The 29s was a **component sum built from `CLAUDE.md`'s prose**, which listed
`lint-ratchet` among pre-commit's steps. The hook itself did not run it. Row 1.0 existed precisely
because "the floor is a component sum and may understate" — it turned out to _overstate_, and by
enough to invent the tier.

So **all three** of this plan's opening premises are now falsified, not two. The scoreboard in the
Executive summary is corrected accordingly.

**The reusable lesson is narrower than "re-measure".** I did measure — `typecheck` and
`lint:ratchet` were both timed directly and both numbers were right. What was wrong was the
**composition**: which of them the hook actually invokes. A correct measurement of the wrong set
is still a wrong answer, and reading `CLAUDE.md` instead of `.husky/pre-commit` is what chose the
set. **Measure the parts against the file that composes them, not against the doc that describes
it.**

**Concurrent-session collision.** Two sessions independently diagnosed the same problem within the
hour and one implemented it. Nothing in the workflow surfaced that: the plan was authored against a
tree whose `.husky/pre-commit` changed underneath it (mtime 21:57, commit 21:59). Re-reading target
files at execution time is what caught it — the same discipline the worker-brief contract already
mandates ("the worker re-verifies anchors at edit time rather than trusting them"), here needed by
the main session against its own freshly-written plan.

### Tier 2: The single surviving migration candidate. — COMPLETE 2026-08-11.

| ID  | Status | Step                                                                                                                                                                                                                                                | Files                                                                                    | Depends | Verification                                                                                            |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| 2.1 | ✓      | Establish whether dependency-cruiser can express `no-crosslayer-relative`'s resolved-path rule. **It can** — `$1` back-reference compares TO-layer against FROM-layer, and `dependencyTypesNot` separates the subpath specifier from a relative one | `.dependency-cruiser.cjs`                                                                | —       | **DONE** — rule fires on all 4 of the guard's self-test cases, 0 false positives on the real tree       |
| 2.2 | ✓      | Migrate, negative-verify, then delete the guard + its 2 npm entries + suite membership in one commit                                                                                                                                                | `.dependency-cruiser.cjs`, `package.json`, `run-validation-suite.js`, `eslint.config.js` | 2.1     | **DONE** — guard deleted (−169), rule added (+28), `validate:all` **34 → 33 members**, arch 0 errors    |
| 2.3 | ✓      | **NEW** — `eslint.config.js:131` carried a comment pointing at the deleted script and asserting the resolved-path argument as if it ruled out every standard tool. Docs/Code Lockstep                                                               | `eslint.config.js`                                                                       | 2.2     | **DONE** — comment now names the depcruise rule and records why the original reasoning over-generalised |

**Gate**: **MET** — net **−141 LOC** with coverage proven equal on all four self-test cases.
`validate:arch` 0 errors / 4 pre-existing warnings; `validate:suite-membership` PASS at 33 members.

#### Tier 2 execution record (2026-08-11)

**Equivalence was established by planting, not by reading.** The candidate rule was run against
each of the retiring guard's four `SELF_TEST_CASES` reproduced as real files in `src/`:

| Planted case                                         | `no-crosslayer-relative` |
| ---------------------------------------------------- | ------------------------ |
| type-only `../../infra/logging/index.js` from `mcp/` | **caught**               |
| 4-deep `../../../../shared/utils/index.js`           | **caught**               |
| dynamic `await import('../../modules/prompts/...')`  | **caught**               |
| intra-layer `../gates/services/...` within `engine/` | **correctly ignored**    |

Plus the stronger accept evidence: on the clean tree the rule reports **0** violations while the
tree contains **197** legitimate deep intra-layer relative imports.

**Two probes were wrong before they were right, and both would have shipped a coverage regression:**

1. **`dependencyTypes: ['local']` reported 218 violations** against a guard that reports 0. `local`
   describes the _resolved module's nature_, not the _specifier's syntax_ — a `#shared/x.js`
   subpath import also resolves locally. The fix is `dependencyTypesNot: ['aliased-subpath-import',
…]`, which is the property actually being asked about.
2. **The first correct-looking rule silently missed a planted violation.** A type-only cross-layer
   relative is elided after compilation, so depcruise could not see it. `tsPreCompilationDeps` is
   what makes it visible — and `.dependency-cruiser.cjs` **already enables it** (line 278), so no
   option change was needed. Had the rule been written without checking, the migration would have
   dropped type-only imports from coverage with every test still green.

**A transient `1 error` in `validate:arch` was my own orphaned probe file**, not a regression —
caught because the baseline was re-measured after cleanup rather than assumed.

**Why this one migrated when the other five cannot.** `eslint.config.js` documented the correct
reason it was not an ESLint rule (a textual `../../*` ban flags 197 legitimate imports) and then
over-generalised it to "no standard tool can do this". Resolution is exactly what dependency-cruiser
does, and it was already running. The precedent existed in-repo and was missed by this plan's own
Finding 1: `validate-no-tool-layer-validator-imports.js` was deleted 2026-08-06 on the identical
reasoning, and `validate-no-crosslayer-reexport.js` was ported to a custom ESLint AST rule. **This
project already runs the consolidation this plan proposed; Finding 1 read six `MECHANISM:`
annotations as proof that none could move, when one of them was a stale over-generalisation.**

### Explicitly NOT in this plan

- **Migrating the other 5 `no-*` guards.** Their reach reasons were re-read after Tier 2 and hold:
  `no-legacy-sidecars` and `no-llm-client` scan `../cli/src` and `../hooks` (outside both the ESLint
  root and the depcruise cruise), `no-stepstate` scans `tests/`, `no-methodology-vocab` reads
  `.md`/`.json`/`.yaml`, `no-phantom-columns` compares SQL columns to writers. **But Tier 2 proved
  the annotation is not self-certifying** — one of the six was a stale over-generalisation. Re-test
  a reach claim against dependency-cruiser specifically before trusting it for a TS-only guard.
- **Any expiry/`reviewAfter` mechanism.** Rejected; see Finding 2.
- **Reducing `validate:all`'s 34 members.** Tier V already negative-verified 19 of 20 as
  falsifiable, and the cost is not runtime. A member that can fail is not debt.

---

## Risks

| Risk                                                                   | Impact                                                                    | Mitigation                                                             | Rollback              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------- |
| Moving `lint:ratchet` to pre-push lets a regression sit locally longer | Low — it still cannot reach `origin`                                      | 1.3 plants the regression and proves the push boundary holds           | Revert `.husky` diff  |
| depcruise rule looks equivalent but scopes differently                 | **High** — silent coverage loss, the exact failure Tier 2 exists to avoid | 2.2 blocked on 2.1 passing the guard's own `--self-test` fixtures      | Restore guard + entry |
| Pre-commit changes collide with a concurrent session                   | Medium — `.husky/*` are shared files                                      | Stage by explicit path; never `git checkout` a directory (Deviation 8) | Per-file revert       |

## Growth capture

- [ ] **Pattern (2nd sighting)**: a plan's own justifying argument carried an unmeasured count
      forward from a sibling plan's prose. First sighting was the shim-debt sweep's ten falsified
      counts; this is the same defect in the _rationale_ rather than the work list. Candidate for
      `/knowledge-capture` — the rule that generalises is **re-measure the numbers you are using to
      argue for the work, not only the numbers inside the work.**
- [ ] **Correction to log**: a `MECHANISM:` annotation in a guard's header is a reach/resolution
      justification and answers "why not ESLint" directly. Read it before proposing a migration.
