# Shim & Compat-Alias Debt Sweep

**Date**: 2026-07-29
**Branch**: `feat/gate-precedence-injection-launcher-docs` (renamed; `chore/shim-debt-sweep` never cut — 0.1 still pending)
**Work type**: refactor (secondary: bug_fix)
**Status**: **Tiers 0–2 complete except 0.1 (commit, awaiting operator) and 2.3 (partial — 3 target
files are held by a concurrent session).** 17 of 20 steps in Tiers 0–2 done. Tiers 3, 4, IT unstarted.

| Measure                | Baseline  | Now           | Δ         |
| ---------------------- | --------- | ------------- | --------- |
| knip unused files      | 57        | **22**        | −35       |
| knip duplicate exports | 3         | **1**         | −2        |
| depcruise modules      | 461       | **436**       | −25       |
| `validate:all` members | 11        | **15**        | +4 guards |
| Unit tests             | 1631 pass | **1696 pass** | —         |
| depcruise errors       | 0         | **0**         | —         |

Gate at completion: `typecheck` 0 · `build` 0 · `validate:all` 0 · `validate:arch` 0 errors ·
`lint:ratchet` 0 (3485 errors / 1435 warnings, no regressions) · `test:ci` 1696 passed.
`test:e2e` has 1 pre-existing failure, proven unrelated — see Deviation 9.

---

## Executive summary

The premise "this codebase is full of shims and flags added as if it had many users" checked out, but **not on the axis expected**. Recon falsified the feature-flag hypothesis outright: exactly **one** `process.env` gate exists in 103k lines (`NODE_ENV`). There is no flag registry and no LOCK/parity gate.

The actual debt is **half-finished renames plus speculative compat aliases** — one concept carrying two live names, plus ~40 defensive fallbacks serving an installed base that does not exist.

This distinction drives the whole plan: a flag has a boolean you flip and a branch you delete; an alias has N call sites that must all move first.

---

## Measured baseline (2026-07-29)

| Category                 | Measure                       | Probe                                                         |
| ------------------------ | ----------------------------- | ------------------------------------------------------------- |
| Env-var gates            | **1** (`NODE_ENV`)            | `rg -o "process\.env\.[A-Z_0-9]+" src`                        |
| Compat markers           | 385 hits / 118 of 426 files   | `rg -ci "legacy\|deprecated\|backward.?compat\|fallback" src` |
| `@deprecated` tags       | 32                            | `rg -c "@deprecated" src`                                     |
| Explicit compat comments | ~40 (~15 cross-layer barrels) | `rg -n "backward compat\|Kept for\|for compatibility" src`    |
| Unused files             | 57                            | `npx knip` (**unconfigured**)                                 |
| Unused exports           | 482                           | `npx knip`                                                    |
| Unused exported types    | 879                           | `npx knip`                                                    |
| Source size              | 426 files / 103,475 lines     | `fd -e ts . src \| wc -l`                                     |

### Dual vocabulary — classes renamed, identifiers not

| Old                   | New                 | old refs | new refs |
| --------------------- | ------------------- | -------- | -------- |
| `framework*`          | `methodology*`      | 3162     | 1770     |
| `delegat*`            | `handoff*`          | 336      | 46       |
| `mode`                | `trigger`           | 811      | 175      |
| `ChainSessionManager` | `ChainSessionStore` | 143      | 30       |
| `StepState`           | `StepLifecycle`     | 63       | 22       |

### Verified zero/low-consumer symbols

| Symbol                         | src refs      | Note                                              |
| ------------------------------ | ------------- | ------------------------------------------------- |
| `GateManager.getCategoryGates` | **0 callers** | `gate-manager.ts:282`; only its own log at `:313` |
| `ChainSessionManagerOptions`   | 2             |                                                   |
| `createChainSessionManager`    | 4             |                                                   |
| `ExecutionMode`                | 5             |                                                   |
| `ExecutionModeSchema`          | 5             |                                                   |
| `atomicWriteFile`              | 0             | already removed                                   |

---

## Phase 1 — Discovery & Triage

```
search_type   : exploratory (+ dependency_trace on deprecated-symbol consumers)

intent:
  work_type     : refactor
  secondary     : bug_fix
  risk          : medium-high
  external_deps : knip@^5.86.0 (dev, unconfigured), ts-morph (dev),
                  dependency-cruiser (dev), eslint+sonarjs. No new runtime deps.
  source_spec   : plans/techincal_debt/arg-gate-pipeline-fixes.md (STALE — see 0.4)
                  docs/adr/0001-gate-resolution-precedence.md (accepted 2026-07-29)
  problem       : Current — one concept carries two live names across the codebase, ~40 compat
                  sites and 32 deprecated tags serve a nonexistent installed base, 57 files and
                  482 exports are unreferenced. A reader cannot tell which name is authoritative
                  or which fallback is load-bearing, so every change re-litigates the question.
                  Desired — exactly one name per concept, dead paths deleted rather than
                  deprecated, each retirement mechanically locked by a guard in validate:all.
  next_phase    : design
confidence    : high
```

### Sibling patterns found

1. **Anti-regression guard scripts already exist** — `scripts/validate-no-legacy-sidecars.js`,
   `validate-no-prompt-gates-alias.js`, `validate-no-tool-layer-validator-imports.js`
   (38-48 lines each, `rg`-based, exit 1 on match).
   **All three are wired to NOTHING** — absent from `package.json`, `.husky`, `.github`
   (confirmed: `rg` exit 1). The pattern is correct; only the wiring was never finished.
   _This is itself an instance of the debt class under repair._
2. **Rename tooling exists** — `scripts/rename-symbols.ts`, ts-morph, `--dry-run`, `--tier N`,
   6-tier RENAMES table. Its docstring self-documents four blind spots: file renames, string
   literals in logs/errors, test files (excluded from tsconfig), Python hooks/docs/CLAUDE.md.
3. **Dead entries inside that table** — tier 3 holds four identity no-op renames
   (`FrameworkStateStore → FrameworkStateStore` and three siblings). Same pattern, third instance.
4. **Deletion-over-deprecation is the local norm** — `GateSetResolver` absorbed 8 planner private
   methods, and two dead competing resolvers were deleted outright (−280 lines), not deprecated.
5. **`lint:ratchet` + `.eslint-ratchet-baseline.json`** — monotonic ceiling failing only on
   _increase_, so deletions silently slacken it unless re-baselined.

---

## Phase 2 — Design & Pre-flight

### Pre-flight result

| Check       | Verdict  | Evidence                                                                                                                    |
| ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| domain      | pass     | per-symbol `rg` → owning module; deletions stay in owner                                                                    |
| layer       | pass     | no logic moves between layers; guards are build tooling                                                                     |
| naming      | **FAIL** | `rename-symbols.ts:35-36` renames `GateManager`/`FrameworkManager`; `CLAUDE.md:57/65/66` names both as authoritative owners |
| complexity  | pass     | guards = 1 function, ~40 lines, no nesting beyond try/catch                                                                 |
| size        | pass     | guards 38-48 lines (utility range 50-200); all other tiers net-negative                                                     |
| service     | pass     | `fd "validate-no-"` → capability EXISTS, extend don't invent                                                                |
| defined     | pass     | guards defined, wiring absent → reuse + wire                                                                                |
| contracts   | pass     | no `tooling/contracts` or `_generated` file in scope                                                                        |
| pattern     | pass     | deletions preserve OOP-shell/FP-internals                                                                                   |
| reuse-scope | pass     | guard pattern generalizes to every retired vocabulary                                                                       |
| persistence | n/a      | no state mutation                                                                                                           |
| lib-api     | **FAIL** | no knip config (`ls` ENOENT ×3) → output = tool defaults, not project intent                                                |
| lib-version | pass     | knip ^5.86.0, ts-morph present; upgrades are a non-goal                                                                     |

**failures: 2**

### Compound diagnosis: **Untrusted Inventory**

Both failures share one root: _the inputs to this sweep are artifacts never reconciled with the
codebase they describe._ The stale `arg-gate-pipeline-fixes.md` status column is a third instance.

**Remediation**: no tier may consume a generated or authored work list until that list is
reconciled against the filesystem. Configuration and reconciliation become **Tier 0**, ahead of
all deletion.

**Delegation consequence**: agents may execute against a _reconciled_ list; they may not produce
the reconciliation, because the failure being corrected is precisely that of trusting an
unreconciled artifact.

### Key decisions

| Decision            | Chosen                                                      | Rejected                          | Why                                                                                                                              |
| ------------------- | ----------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Sequencing          | Commit `relicense/readme-rework` first, sweep on new branch | Fold into current dirty tree      | Current tree mixes licensing, README, and a live parser defect fix; a 100+ file refactor on top is unreviewable and unrevertable |
| knip list           | Write `knip.json`, re-run, triage each entry                | Delete all 57 flagged files       | Unconfigured knip flags re-export barrels by construction                                                                        |
| Tier 3 naming table | Human ruling BEFORE any rename                              | Execute existing table as written | Would desync CLAUDE.md from the code it governs                                                                                  |
| Regression lock     | Wire 3 existing guards + 1 per retired vocabulary           | ESLint rules                      | Ratchet fails only on _increase_; an alias could reappear below the ceiling                                                      |
| Compat sites        | Agents report; human decides; nothing auto-applied          | Auto-delete unconsumed fallbacks  | A fallback may be the only handler for a real edge case                                                                          |
| `getCategoryGates`  | Migrate assertions, then delete                             | Delete method + tests together    | The assertions encode real behavior; relocate, don't lose                                                                        |
| Ratchet             | Re-baseline after every tier                                | Leave untouched                   | Stale high ceiling silently re-admits violations                                                                                 |

### Identification (guard scripts)

```
behavior  : Fails the build when a retired identifier reappears in src. Does not fix or advise —
            a tripwire with an exit code.
state     : none — reads filesystem via rg, holds nothing across invocations
shape     : function (one runCheck per vocabulary), NOT a class — derived from having no state
placement : scripts/ as standalone node ESM, invoked from validate:*. Never src/ — build tooling
            must not enter the runtime bundle.
```

---

## Phase 2.5 — Verification (raw-probe results)

All 8 design-referenced files exist. **No shims** — smallest is 38 lines, above the 25-line signal.

| File                                                      | Lines | Claim                      | Actual                      | Drift     |
| --------------------------------------------------------- | ----- | -------------------------- | --------------------------- | --------- |
| `scripts/validate-no-prompt-gates-alias.js`               | 38    | shape to clone             | `PATTERN:5`, `TARGET:10`    | none      |
| `scripts/rename-symbols.ts`                               | 236   | RENAMES 28-80              | `:35` Framework, `:36` Gate | none      |
| `package.json`                                            | 173   | `:87`, `:40-41`            | exact                       | none      |
| `src/engine/gates/gate-manager.ts`                        | 349   | `getCategoryGates` 282-315 | `:282` def, `:313` own log  | none      |
| `tests/integration/gates/gate-category-selection.test.ts` | 198   | **12 assertions**, 48-92   | **9 `expect()`**, 48-96     | **MAJOR** |
| `src/engine/gates/services/gate-set-resolver.ts`          | 428   | veto 269-271               | `:273` (+`:277`, `:282`)    | ±10       |
| `.dependency-cruiser.cjs`                                 | 273   | `:148`                     | exact                       | none      |
| `CLAUDE.md`                                               | 115   | Domain Matrix              | `:57`, `:65`, `:66`         | none      |

### Corrections that Phase 3 must use

1. **9 assertions, not 12.** The `12` was `rg -c` counting _lines mentioning the string_
   (including the line-5 header comment and the line-48 `describe` title).
   `sed -n "48,96p" ... | rg -c "expect\("` → **9**. Block bound is **48-96** (next `describe`
   at 97). The file's other 13 `expect()` calls belong to `selectGates()` blocks — **out of scope**.
2. **Veto at `:273`**, not 269-271. Siblings at `:277` and `:282`.

### Absence claims — both CONFIRMED by probe

- Guards orphaned: `rg` across `package.json ../.husky ../.github` → exit 1, no output.
- No knip config: `ls` ENOENT on `knip.json`, `knip.jsonc`, `.kniprc`.

### Incidental finding (added to Tier 4)

`resources/methodologies/cageerf/phases.yaml` pairs `id: context_establishment` with
`section_header: '## Context'`. The `implementation_plan/verification` prompt documents the **id**
as the required markdown heading while the phase guard enforces the **section_header** — which
caused a real gate failure during this planning session. Same one-concept-two-names defect, living
in methodology config.

---

## Phase 3 — Implementation table

### Tier 0: Establish trust. No deletion in this tier.

| ID  | Status | Step                                                                                                                                                                                                                                                          | Files                                             | Depends                            | Verification                                                                                                                                                                |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.2 | ✓      | Run `node scripts/generate-gate-index.js` to index `creed-fidelity` + `math-fidelity`. **REORDERED — see Deviation 1**                                                                                                                                        | `server/resources/gates/_index.md`                | —                                  | `npm run validate:gate-index` → "✓ up-to-date"; both gates present at `_index.md:15` and `:64`; 21 gates + 1 config dir = 22 dirs                                           |
| 0.1 | ⊘      | **SUPERSEDED.** The `chore/shim-debt-sweep` branch was never cut; Tiers 0-4 and rename passes 1-5 all landed on `feat/gate-precedence-injection-launcher-docs`. Left as ⊘ rather than ✓ because the step did not happen — the plan's branching assumption did | (branch)                                          | 0.2                                | n/a — `git branch --show-current` = `feat/gate-precedence-injection-launcher-docs`                                                                                          |
| 0.3 | ✓      | **NEW** knip config. Shipped as ignore-`_generated`-only; **did NOT ignore `scripts/migration/**` — see Deviation 6\*\* (doing so would make 1.3's verification vacuous). Run out of tier order during Tier 2                                                 | `server/knip.json`                                | ~~0.1~~ (none — additive new file) | **DONE** — `npx knip` runs with config; unused files **56** vs unconfigured **57**. Premise largely falsified: the config buys one line, the report was already trustworthy |
| 0.4 | ✓      | Correct stale status column: mark item 2.4 done, cite `gate-set-resolver.ts:273/277/282`                                                                                                                                                                      | `plans/techincal_debt/arg-gate-pipeline-fixes.md` | 0.1                                | `rg -n "2\.4" plans/techincal_debt/arg-gate-pipeline-fixes.md` shows completed marker                                                                                       |
| 0.5 | ✓      | **RULED 2026-07-29 (human)**: renames APPROVED; `CLAUDE.md` Domain Ownership Matrix updates to match in the same commit as 3.9                                                                                                                                | (decision)                                        | 0.1                                | Ruling recorded in this file — see Naming Ruling below                                                                                                                      |
| 0.6 | ✓      | Delete the 4 identity no-op RENAMES entries (`FrameworkStateStore`, `GateStateStore`, `TextReferenceStore`, `ConversationStore` → themselves)                                                                                                                 | `server/scripts/rename-symbols.ts`                | 0.5                                | `rg -n "oldName: '(\w+)', newName: '\1'" server/scripts/rename-symbols.ts` returns 0                                                                                        |

**Gate**: `npm run typecheck && npm run lint:ratchet && npm run test:ci && npm run validate:all`

### Deviations

**Deviation 1 — 0.2 reordered ahead of 0.1 (found during execution, 2026-07-29).**
The plan had 0.2 depending on 0.1 (commit first, then regenerate the index). That is backwards.
`git status --short server/resources/gates/` shows `creed-fidelity/` and `math-fidelity/` as
**untracked additions in the current branch's own working tree**, and `_index.md` is tracked.
The stale index is therefore caused by `relicense/readme-rework`'s own uncommitted work, not by
anything the sweep introduces — and that branch could not pass `validate:all` until the index was
regenerated. Regeneration belongs to the branch being committed, so it ran first.
Conservative option taken: run 0.2 on the current branch, leave 0.3/0.4/0.6 for the sweep branch
so no cleanup work contaminates the release commit.

**Deviation 2 — commit/split HALTED, concurrent session detected (2026-07-29 19:05).**
Another session is writing to this working tree. Evidence: `loader.ts` mtime 19:05:45 against a
19:05:47 probe; `markdown-prompt-parser.ts` appeared in the tree between two consecutive
`git status` runs; tracked+untracked count went 48 → 57 during this tier. Staging anything under
those conditions risks committing a half-written file, so **no commit, no split, nothing staged**
— per the "split only if safe and non-destructive" instruction. Step 0.1 remains ☐.

**Deviation 3 — integration tests are run by NOTHING, and have rotted.**
Discovered while acting on the `test:ci` caveat below. `test:ci` = `test:unit`; CI's test job ran
unit → coverage → e2e; `.husky/pre-push:43` and `npm-publish.yml:79` both call `test:ci`.
`npm run test:integration` was therefore never executed by any automated path. Measured today:
**8 failing suites / 25 failing tests out of 349**, and the failure set is not stable between runs
(`gates/shell-verification-flow` failed one run, passed the next on a 1500ms timing assertion) —
so this is genuine rot plus flakiness.

Failing suites: `database/resource-change-tracker-baseline`, `database/sqlite-backend`,
`framework/methodology-creation`, `gates/gate-shell-verify-review-feedback`,
`hooks/response-capture-hooks`, `resources/resource-registration`, `skills-sync/pull-command`,
`versioning/version-history-workflow` (+ intermittently `gates/shell-verification-flow`).

**Testing process changes made (2026-07-29):**

| Change                                                                          | File                       | Rationale                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Added `validate:full` = `typecheck && lint:ratchet && test:all && validate:all` | `server/package.json`      | A single local command that actually covers unit + integration + e2e. `validate` was aliased to `test:ci` (unit only) and misrepresented its coverage                                                             |
| Added non-blocking "Integration tests" step                                     | `.github/workflows/ci.yml` | Makes the rot visible without breaking the build. `continue-on-error` is declared DEBT with a written retirement condition: when `test:integration` is green locally, delete the flag and move the step above E2E |
| Left `test:ci` unchanged                                                        | —                          | Wiring a red suite into `test:ci` would break CI, `pre-push`, and `npm-publish` immediately — including for the concurrent session                                                                                |

~~Repairing the 8 integration suites is now a prerequisite for Tier 1.~~ **Corrected 2026-07-29:
it is not.** The claim was asserted, not checked. `gate-category-selection` — the only suite step
1.1 touches — is **not** among the 8, and was verified 16/16 green both before and after the
migration. The rule that generalizes: a red _suite_ blocks only the steps whose _own_ target suite
is red. Check the specific suite before declaring a step blocked.

**Note on `test:ci` coverage.** `npm run test:ci` runs `tests/unit` only (139 suites / 1675 tests
as of Tier 1; 136/1631 when first measured). Tier gates claiming "test:ci green" prove unit-level
correctness ONLY — steps touching chain execution or gate resolution (1.1, 1.2, 2.2, 3.x) must
additionally run the specific `test:integration` suite they target.

**Deviation 4 — step 1.1 migrated onto `selectGates()`, not `GateSetResolver` (2026-07-29).**
The plan named `GateSetResolver` as the migration target. Reading it first showed that is the
wrong layer: `GateSetResolver.registryGateIds()` (`gate-set-resolver.ts:212-244`) does not
reimplement category activation — it _calls_ `gateManager.selectGates({enabledOnly, promptCategory,
framework?})`. Migrating onto the resolver would have meant fabricating a `ConvertedPrompt` per
test to reach the same query through an async wrapper. The 9 assertions now issue that query
directly, which is both the behaviour under test and the code path the resolver depends on.

Two equivalence checks were run before migrating, because the two encodings were not identical:

| Difference                                                                                  | Probe                                                                                                                         | Resolution                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getCategoryGates` lowercased the category; `selectGates` does not                          | Read `checkRegularGateActivation` in `gates/utils/gate-activation.ts` — it lowercases **both sides** internally               | No behaviour change. The caller-side `.toLowerCase()` was redundant with the activation predicate — a third piece of evidence that `getCategoryGates` was a duplicate encoding                                                                                                 |
| `getCategoryGates` hardcoded `gateType === 'framework'` exclusion; `selectGates` derives it | Enumerated every gate with `gate_type: framework` → exactly one (`framework-compliance`), and it declares `framework_context` | Equivalent for every gate that exists. Divergence is possible only for a hypothetical framework gate declaring no `framework_context` — and YAML-declared activation is the intended design, so the derived behaviour is the correct one. Stated in a comment at the call site |

One of the 9 assertions ("excludes framework gates") partially overlaps an existing assertion at
`:108-117`. Kept rather than dropped: the step's purpose is preserving coverage, and the migrated
one exercises two categories where the existing one exercises one.

**Deviation 5 — the Tier 1 heading is falsified for rows 1.4 and 1.5 (found 2026-07-29).**
Tier 1 is titled _"Delete probe-confirmed zero-consumer code."_ Probing each row before executing
showed two rows were never probe-confirmed:

- **1.4** — `createChainSessionManager` has a **live call site**: imported at
  `prompt-executor.ts:53`, invoked at `:179`; also re-exported from `chain-session-store.ts:8,10`.
  It is a live alias, not dead code. Deletion requires migrating the call site to
  `createChainSessionStore` first. Row rewritten to say so.
- **1.5** — `ExecutionModeSchema` has **live consumers**: `script-schema.ts:64` derives
  `ExecutionModeYaml` from it and `:122` uses it in the parser (`mode: ExecutionModeSchema.optional()`).
  Deleting it would break script schema parsing. Separately, the row conflated it with
  `ExecutionModeService` — a live subsystem wired through `04b-script-execution-stage.ts` and
  `ExecutionModeServicePort`, ~30 call sites. Only the bare `ExecutionMode` **type** is dead.
  Row rescoped.

This is the Untrusted Inventory diagnosis reappearing **inside this plan** — the same defect the
sweep exists to remove. Rows 1.3 and 1.6 were re-probed for the same failure and hold up: 1.6's
three `@deprecated` aliases are at `strategy.ts:78/83/88` as stated. Every remaining tier row
should be re-probed at execution time rather than trusted from the planning pass.

**Deviation 6 — 0.3 executed out of tier, and its premise was mostly wrong (2026-07-29).**
0.3 (`server/knip.json`) is a Tier 0 row listed as depending on 0.1, the halted commit. It was run
during the Tier 2 invocation because it is the sole input to 2.1 and is additive: a new untracked
file, touching nothing the concurrent session holds. Same reasoning as Deviation 1.

The measured result contradicts the plan's reason for the step. 0.3 exists because an unconfigured
knip "reports 57 unused files" and deleting against an unaudited number is unsafe. But knip already
resolves npm-script-referenced scripts, jest tests via its jest plugin, and `main`/`bin` entries —
which is why `validate-readme.js`, `eslint-ratchet.js`, and `generate-contracts.ts` were never in
the 57. Measured both ways:

|              | Unused files | Unused deps | Unlisted | Duplicate exports |
| ------------ | ------------ | ----------- | -------- | ----------------- |
| Unconfigured | 57           | 1           | 162      | 3                 |
| Configured   | **56**       | 1           | 162      | 3                 |

The config buys exactly one line — ignoring `_generated/**`, so a regenerated artifact can never
surface as dead code. **The report was already trustworthy.** 1.3-1.6 were gated for four tiers on
a step worth one line of output.

Two attempts were needed. The first config declared `entry`/`project`/`jest` explicitly; it
produced the same 162 "unlisted dependency" lines, which was briefly misread as the config having
_introduced_ that noise. It had not — the unconfigured baseline had been truncated at `head -60`,
one line before the section began. Re-measured with both configs and with none. The shipped config
is the minimal one that earns its keep.

Deliberately **not** in the config, contra the plan's "ignore `scripts/migration/**`": that
directory is exactly what step 1.3 deletes, and 1.3's verification is _"`npx knip` no longer lists
them."_ Ignoring it would make that verification pass without anything being deleted. `tests/manual/**`
and the three orphaned guards are left visible for the same reason — hiding a true positive to
tidy a report is the defect this sweep exists to remove.

**Deviation 7 — 2.1's dependency on 1.7 dropped (2026-07-29).**
2.1 was listed as depending on 0.3 **and** 1.7 (wire the orphaned guards). 1.7 is what stops
deleted things from being reintroduced, which 2.2 needs and an audit does not: 2.1 reads code and
writes a classification, changing nothing a guard could protect. Kept for 2.2, dropped for 2.1.

**Deviation 8 — INCIDENT: `git checkout --` on directories destroyed ~447 lines of another
session's uncommitted work (2026-07-29). Recovered by that session; no permanent loss.**

While isolating whether the barrel deletion caused an e2e failure, `git checkout --` was run on a
list of **directories** (`src/engine/gates`, `src/mcp/tools/prompt-engine/core`, …) intending to
restore 22 `index.ts` files. It reverted every tracked file beneath those paths. Four files
carrying uncommitted edits went back to HEAD: `temporary-gate-registrar.ts` (−239 lines),
`gate-enhancement-service.ts` (−173), `chain-session-router.ts` (−18), `gates/types.ts` (−17).

Untracked files were untouched (`git checkout` does not remove them), so `gate-set-resolver.ts`,
`gate-body-merge.ts`, `methodology-injection.ts`, `launcher-envelope.ts` and their tests survived.
Local recovery was exhausted and failed: 63 dangling git blobs, none matching; `.history/` holds
only root-level configs; `dist/` had already been rebuilt. The other session restored its own work
from context — verified afterwards by line count and non-empty `git diff HEAD`.

**Rules adopted, and they bind the rest of this sweep:**

1. **Never pass a directory to a destructive git command in a shared tree.** Enumerate files. The
   22 paths were already enumerated in the audit script; passing them would have cost nothing.
2. **Quiet is not gone.** The decision to treat the concurrent session as inactive rested on 20
   minutes of unchanged mtimes. Their work was in the tree the whole time regardless of activity.
3. `rm` for deleting files this plan owns; `git checkout HEAD -- <explicit paths>` only, and
   re-verify the modified-file count is unchanged immediately after.

_(A later attempt hit a shell-quoting bug that collapsed 22 paths into one pathspec. It failed
loudly and changed nothing — the right failure mode, and the reason rule 3 pairs the command with
an immediate count check.)_

**Deviation 9 — the e2e failure was NOT caused by this tier (measured 2026-07-29).**
`tests/e2e/mcp-server-smoke.test.ts › server registers expected MCP tools via HTTP` fails on a
10s SSE handshake timeout. Ownership was established by measurement, not inference:

| Tree state                                                 | e2e result       |
| ---------------------------------------------------------- | ---------------- |
| HEAD in a clean worktree (no concurrent work, no deletion) | **3/3 pass**     |
| Concurrent work present + 22 barrels **restored**          | **5/5 fail**     |
| Concurrent work present + 22 barrels **deleted**           | ~2 pass / 7 fail |

Restoring the barrels does not fix it. The failure tracks the concurrent session's uncommitted
work, not the barrel deletion. Not this sweep's defect — routed to Tier IT, whose IT.0 re-measure
against a clean HEAD is exactly the step that will characterize it.

**Deviation 10 — 1.7 was blocked on a fact the plan had backwards: the guards were RED, not just
unwired (2026-07-29).**
The plan's sibling-pattern finding read _"The pattern is correct; only the wiring was never
finished."_ Running them first showed all three **exit 1**. Wiring them as written would have made
`validate:all` fail on the first invocation. Each needed a different response, and the difference
matters:

| Guard                                      | Verdict                     | Action                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate-no-legacy-sidecars`              | **Guard right, code wrong** | `docs/reference/mcp-tools.md:957-971` still documented per-resource JSON version sidecars, removed when versioning moved to SQLite. Docs rewritten to describe `state.db`                                                                                                                               |
| `validate-no-prompt-gates-alias`           | **Guard right, code wrong** | `prompt-lifecycle-processor.ts:120` read `args['gate_configuration'] \|\| args.gates`. Probed: `router.ts:166` never passes `gates` to the prompt path, and `gates` on `resource_manager` is a **Methodology** parameter (`resource-manager.schema.ts:121`). Dead fallback across two domains — removed |
| `validate-no-tool-layer-validator-imports` | **Guard wrong, twice**      | Fixed — see below                                                                                                                                                                                                                                                                                       |

**The third guard is the "rule limiting cleanup" case, and it was wrong on two separate axes:**

1. **Type-only imports.** Its regex matched `import type` identically to a value import, so a
   type-only `StyleToolDescriptionYaml` read as a boundary breach. Every rule in
   `.dependency-cruiser.cjs` already draws this distinction (`dependencyTypes` /
   `dependencyTypesNot: ['type-only']`); this guard was the outlier. Types are erased at compile
   time and pull no validation logic across the boundary.
2. **`src/mcp/tools/schemas/` composing shared Zod fragments.** `resource-manager.schema.ts:11`
   imports `ChainStepSchema` to build the `chain_steps` **parameter** schema. The guard defends
   against the tool layer running **resource-content** validation instead of delegating to
   `ResourceVerificationService` — a different job. `.claude/rules/mcp-contracts.md` assigns MCP
   parameter validation to exactly this directory. Forbidding it would force a duplicate copy of
   the shape, i.e. cause the SSOT defect this sweep removes.

Both exemptions are narrow and were proven so by negative test, not asserted: a value import
_outside_ `schemas/` still exits 1; a value import _inside_ `schemas/` exits 0; removing the probe
returns to 0. The rule was bent toward the codebase's own established semantics, not toward green.

**Deviation 11 — 2.3 partially executed; 3 of its target files are held by the concurrent session.**
Removed and repointed: `modules/chains/chain-session-store.ts` (2 test consumers),
`modules/chains/types.ts` (3 consumers → `shared/types/chain-session.js`),
`infra/observability/metrics/types.ts` (2 consumers → `shared/types/metrics.js`).

Left untouched **because the concurrent session has uncommitted edits in them**:
`modules/prompts/types.ts`, `engine/execution/types.ts`, `shared/types/index.ts`. Also left:
`src/types.ts` (many consumers, Tier 3 scale) and `infra/logging/index.ts` (a 495-line
implementation, not a shim — only its `Logger` re-export line is compat).

After this pass exactly **one** pure re-export shim remains repo-wide (`src/types.ts`), which is
what let 2.4's guard ship green with a single documented allowlist entry.

_Method note, twice-learned_: the first importer count for `metrics/types.ts` came back **0** and
was wrong — the regex missed sibling-relative `from './types.js'`, the same blind spot that
produced the bogus barrel counts in 2.1. Re-probed for the relative form before deleting anything.

**Housekeeping completed (2026-07-29):**

- Branch renamed `relicense/readme-rework` → `feat/gate-precedence-injection-launcher-docs`.
  Verified local-only (`git ls-remote --heads origin` empty) before renaming; `git branch -m`
  touches only the ref, and `origin/main` tracking was preserved.
- `.gitignore:99-102` — `.codex/` → `.codex` (and `.clinerules/` → `.clinerules`). A trailing
  slash matches directories ONLY, which let a zero-byte `.codex` file into `git status`.
  Verified with `git check-ignore -v .codex`.
- Confirmed `CLAUDE.md` IS tracked despite its `.gitignore` entry (already-tracked files override
  ignore rules), so step 3.9's same-commit handbook update is viable.

**Deviation 12 — every count in Tier 3 was wrong, and 4 of its 10 steps are not executable as
written. Measured 2026-07-30 against a clean tree.**

| Step                      | Plan count    | Measured      | Verdict                                 |
| ------------------------- | ------------- | ------------- | --------------------------------------- |
| 3.1 `StepState`           | 63            | **37**        | **MISCLASSIFIED — not a rename**        |
| 3.3 `ChainSessionManager` | 143           | **177**       | valid, executed                         |
| 3.5 `delegat*`            | 336           | **807**       | contract-crossing, needs scope decision |
| 3.7 `mode` (automation)   | 811 repo-wide | **45** scoped | verification target unachievable        |
| 3.9 `framework*`          | 3162          | **4360**      | contract-crossing, needs scope decision |

The tier's premise **does** hold: all five target vocabularies already coexist with their
replacements (`StepLifecycle` 22, `ChainSessionStore` 78, `handoff` 94, `trigger` 68,
`methodology` 2465), so dual vocabulary is real in every case. What fails is the assumption that
each is a _mechanical rename_.

**3.1 is a data-model migration, not a rename.** `StepState` is a 4-value enum
(`PENDING|RENDERED|RESPONSE_CAPTURED|COMPLETED`); `StepLifecycle` is a 6-value union
(`pending|working|input_required|completed|failed|cancelled`). `RENDERED` and
`RESPONSE_CAPTURED` have **no counterpart** — they become `StepSubstate` _flags_
(`renderedAt`, `responseAt`). 7 of the 37 sites use exactly those two members. A textual rename
produces `StepLifecycle.RENDERED`, which does not exist. Worse, the affected files include
`shared/types/chain-session.ts` and `modules/chains/manager.ts` — the blob-encoded
`chain_run_registry` persistence path — so this changes **persisted state shape** and needs a
`SCHEMA_VERSION` bump. This belongs to the SEP-1686 execution-ledger initiative, whose
`@deprecated` tags already describe the intended two-tier target. **Removed from this sweep.**

**3.7's verification is unachievable by construction.** `rg -c "\bmode\b" src/modules/automation`
= 0 cannot be reached, because the survivors are two things that must stay: (a) the deliberate
user-YAML back-compat migration at `core/script-definition-loader.ts:433-444` that maps
`mode: manual → trigger: explicit` and `mode: confirm → confirm: true` for script.yaml files
users have already written, and (b) `ExecutionModeService` / `CommandExecutionMode`, which is a
genuinely _different_ concept (auto/manual/confirm execution filtering), not the retired field.
Retiring (a) is a compat-site classification question — **moved to Tier 4**, which is where
load-bearing-vs-speculative gets decided with evidence.

**3.5 and 3.9 cross the public contract surface.** Probed, not assumed:

- `framework` is a **live MCP parameter name** — `system_control(framework: z.string())` at
  `schemas/system-control.schema.ts:52` and the action literal `case 'framework'` at
  `system-control-router.ts:356`. Clients pass both strings.
- `framework_gates` is a **prompt-YAML authoring field** (`resource-manager.json:110`);
  `framework_context:`, `gate_type: framework`, and `frameworks:` activation rules appear across
  **15 gate/methodology resource files**; the gate id `framework-compliance` is referenced _by id_
  from `methodologies/*/methodology.yaml`.
- `@Framework` is a symbolic-command operator id (`registries/operators.json:64`), as is
  `delegation` (`:24`).
- **Workspace resources overlay bundled ones.** A user's own `gate.yaml` carrying
  `framework_context:` would silently stop activating after the rename, with no migration path
  and no error.

For 3.5 specifically, `handoff` is currently the **display** vocabulary (footer text, `HANDOFF
INSTRUCTIONS`) while `delegat*` is the **identifier** vocabulary — arguably intentional layering
rather than drift.

So both steps are breaking API changes wearing a cleanup costume. The internal portion is real
debt worth fixing; the contract portion is a versioned migration with deprecation, not a sweep.
**Held for an explicit scope decision** — internal-only, or internal + a contract migration with
alias support. Not started either way.

### Naming ruling (step 0.5 — resolved 2026-07-29)

**Approved.** The `Manager → Registry` renames in `scripts/rename-symbols.ts:35-36`
(`FrameworkManager → FrameworkRegistry`, `GateManager → GateRegistry`) proceed.
`CLAUDE.md` is the artifact that moves: the Domain Ownership Matrix at `:57`, `:65`, `:66` is
updated to the new names **in the same commit as step 3.9**, never separately — a handbook that
lags the code by even one commit reintroduces exactly the two-names-one-concept defect this
sweep exists to remove.

### Tier IT: Integration test repair — DEFERRED, but blocks Tier 1

**Status: deferred by decision 2026-07-29.** Not scheduled. Documented here so the finding is not
lost and so nobody mistakes a red baseline for a Tier 1 regression.

**Does it block Tier 1? NO — checked, and the answer is no.**
Step 1.1 touches `tests/integration/gates/gate-category-selection.test.ts`, which was run in
isolation on 2026-07-29 and passes **16/16**. It is not among the 8 failing suites, so 1.1 has a
clean baseline and Tier 1 may proceed while this tier stays deferred.

The general principle still holds and applies to any FUTURE step landing in a red suite: a
migration cannot be verified against a red baseline, because a migration bug is
indistinguishable from pre-existing rot. Check the specific target suite before assuming either
way — as was done here.

#### Finding: this is the SAME defect class as the shim debt

Seven of eight failures are **test-surface drift from completed refactors** — the source moved,
the test double did not. `cleanup-standards.md` §Test Surface Audit names this exactly: _"Mocks
decouple tests from implementations — `rg "OldThing"` misses mock stubs."_

The shim debt leaves a stale **alias** behind; this leaves a stale **test double** behind. Same
root cause: work completed in source, artifact left unreconciled. And because **no automated job
ran these tests** (Deviation 3), the drift was invisible and compounded silently. The missing
guard is why rot accumulated, which is the identical argument for the `validate-no-*` guards in
Tiers 1-3.

#### Measured failures (2026-07-29)

| Suite                                       | Root cause (verbatim)                                               | Class                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `resources/resource-registration`           | `chainSessionManager.getSessionByChainIdentifier is not a function` | Mock drift — mock lacks a method source now calls                             |
| `database/sqlite-backend`                   | `Expected: 16, Received: 15` (schema version)                       | Constant drift — test and `SCHEMA_VERSION` disagree                           |
| `database/resource-change-tracker-baseline` | `ResourceChangeTracker requires serverRoot configuration`           | Constructor signature drift                                                   |
| `hooks/response-capture-hooks`              | `BasePipelineStage requires a logger instance`                      | Constructor signature drift                                                   |
| `framework/methodology-creation`            | `EACCES: permission denied, mkdir '/test'`                          | **Mock boundary escape** — a real filesystem write got past `mockFileService` |
| `versioning/version-history-workflow`       | `manager.history()` returns `null` → 6 cascading failures           | Behavior/wiring drift, single root                                            |
| `skills-sync/pull-command`                  | section-aware content mismatch (`Analyze deeply: {{input}}` absent) | Behavior drift in section handling                                            |
| `gates/shell-verification-flow`             | `duration 3613ms`, asserted `< 1500`                                | **Environmental/flaky** — timing assertion, not rot                           |

Totals: 8 suites / 25 tests failing of 349. `shell-verification-flow` failed one run and passed
the next — the failure set is not stable.

#### CRITICAL caveat — measured against a dirty tree

These numbers were taken while a **concurrent session was actively editing** `loader.ts`,
`converter.ts`, `yaml-prompt-loader.ts`, and `markdown-prompt-parser.ts`. At least
`skills-sync/pull-command` (prompt section handling) and possibly `framework/methodology-creation`
sit directly downstream of those files. **An unknown share of these 8 may be caused by in-flight
work rather than pre-existing rot.**

Do not treat the table above as a rot baseline until step IT.0 re-measures it.

#### Proposed steps (unscheduled)

| ID   | Status | Step                                                                                                                                                         | Files                                                                                                                           | Depends                         | Verification                                                                     |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| IT.0 | ☐      | **Re-measure against a clean HEAD.** Use `git worktree add` to a temp dir — NOT `git stash`, which is destructive with a concurrent session sharing the tree | (worktree)                                                                                                                      | tree quiet                      | Failure set at HEAD recorded; each of the 8 classified pre-existing vs in-flight |
| IT.1 | ☐      | Fix the 2 constructor-signature drifts — pass `serverRoot` / `logger` in test setup                                                                          | `tests/integration/database/resource-change-tracker-baseline.test.ts`, `tests/integration/hooks/response-capture-hooks.test.ts` | IT.0                            | Both suites green                                                                |
| IT.2 | ☐      | Reconcile `SCHEMA_VERSION` — determine whether 15 or 16 is correct from `sqlite-engine.ts`, fix the wrong side                                               | `tests/integration/database/sqlite-backend.test.ts` or `src/infra/database/sqlite-engine.ts`                                    | IT.0                            | Suite green; version asserted once, not in two places                            |
| IT.3 | ☐      | Add `getSessionByChainIdentifier` to the chain-session mock (or switch to the real store)                                                                    | `tests/integration/resources/resource-registration.test.ts`                                                                     | IT.0                            | Suite green                                                                      |
| IT.4 | ☐      | **Fix the mock boundary escape** — a real `mkdir '/test'` must never be reachable from a test                                                                | `tests/integration/framework/methodology-creation.test.ts`                                                                      | IT.0                            | Suite green; no filesystem write outside the temp dir                            |
| IT.5 | ☐      | Diagnose `history()` → `null` root cause; 6 failures share it                                                                                                | `tests/integration/versioning/version-history-workflow.test.ts`                                                                 | IT.0                            | Suite green                                                                      |
| IT.6 | ☐      | Resolve section-handling drift — likely downstream of concurrent prompt-loader work; re-check AFTER that lands                                               | `tests/integration/skills-sync/pull-command.test.ts`                                                                            | IT.0, concurrent work committed | Suite green                                                                      |
| IT.7 | ☐      | De-flake the timing assertion — replace the wall-clock `< 1500ms` bound with a deterministic signal, or widen it with a documented rationale                 | `tests/integration/gates/shell-verification-flow.test.ts`                                                                       | IT.0                            | 10 consecutive runs green                                                        |
| IT.8 | ☐      | **Retire the CI debt**: delete `continue-on-error` from the Integration step and move it above E2E                                                           | `.github/workflows/ci.yml`                                                                                                      | IT.1-IT.7                       | `npm run test:integration` exits 0; CI blocks on integration failures            |

**Gate**: `npm run test:integration` exits 0 across 3 consecutive runs (proves de-flaked, not just
passing once), then `npm run validate:full`.

> IT.8 is the step that makes this tier terminal. Without it, `continue-on-error` becomes a
> permanent parallel path — precisely the anti-pattern `cleanup-standards.md` warns about
> ("a gate you cannot retire is a bug"). The retirement condition is written into `ci.yml` itself.

### Tier 1: Delete probe-confirmed zero-consumer code.

| ID  | Status | Step                                                                                                                                                                                                                                                                                                                  | Files                                                                                                                               | Depends | Verification                                                                                                                           |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | ✓      | Migrated **9** assertions in **48-96** onto `gateManager.selectGates({promptCategory, enabledOnly:true})` — **NOT `GateSetResolver` directly, see Deviation 4**; left the 13 in `selectGates()` blocks                                                                                                                | `tests/integration/gates/gate-category-selection.test.ts`                                                                           | 0.2     | **DONE** — suite 16/16 green (was 16/16 before); `sed -n '/describe..category gate selection/,/^  });$/p' \| rg -c "expect\("` → 9     |
| 1.2 | ✓      | Deleted `getCategoryGates` (`:282` def + `:313` in-body log, 46 lines). Also cleared the stale breadcrumb comment in `gate-enhancement-stage.test.ts:43`                                                                                                                                                              | `src/engine/gates/gate-manager.ts`, `tests/unit/execution/pipeline/gate-enhancement-stage.test.ts`                                  | 1.1     | **DONE** — `rg "\bgetCategoryGates\b" src` → exit 1, 0 matches; `GateActivationContext` import still needed (`:183`, `:245`), retained |
| 1.3 | ✓      | Delete executed one-shot migration scripts                                                                                                                                                                                                                                                                            | `scripts/migration/01-06*`, `fix-extensions.ts`, `shared/project-loader.ts`                                                         | 0.3     | `npx knip` no longer lists them; `npm run build` green                                                                                 |
| 1.4 | ✓      | ~~Delete~~ **MIGRATE THEN delete** `ChainSessionManagerOptions`, `createChainSessionManager`, 4 `@deprecated` tags. **NOT zero-consumer — see Deviation 5**: live call site at `prompt-executor.ts:53`+`:179`, re-exported at `chain-session-store.ts:8,10`                                                           | `src/modules/chains/manager.ts`, `src/mcp/tools/prompt-engine/core/prompt-executor.ts`, `src/modules/chains/chain-session-store.ts` | 0.3     | `rg` both names in `src tests` → 0                                                                                                     |
| 1.5 | ✓      | **SCOPE CORRECTED — see Deviation 5.** Delete only the `ExecutionMode` _type_ (`shared/types/automation.ts:53` + 2 re-exports). **Do NOT delete `ExecutionModeSchema`** — live consumers at `script-schema.ts:64` (`ExecutionModeYaml`) and `:122`. `ExecutionModeService` is a separate live subsystem, out of scope | `shared/types/automation.ts:53`, `modules/automation/types.ts:13`, `modules/automation/index.ts:46-50`                              | 0.3     | `rg "\bExecutionMode\b"` (excluding `Schema`/`Service`/`Yaml`/`FilterResult`) → 0; `npm run typecheck` green                           |
| 1.6 | ✓      | Delete 3 `@deprecated` delegation aliases (`:78/:83/:88`)                                                                                                                                                                                                                                                             | `src/engine/execution/delegation/strategy.ts`                                                                                       | 0.3     | `npm run typecheck` green; `rg` → 0 in src                                                                                             |
| 1.7 | ✓      | **Wire the 3 orphaned guards** as scripts AND into the `validate:all` chain at `:87`                                                                                                                                                                                                                                  | `package.json`, `scripts/validate-no-*.js`                                                                                          | 1.2-1.6 | `npm run validate:all` runs 14 members, exits 0                                                                                        |

**Gate**: `npm run typecheck && npm run test:ci && npm run validate:all && npm run lint:ratchet:baseline`
_(1.3-1.6 are independent — parallelizable)_

**Tier 1 status: PARTIAL (2 of 7). 1.1 + 1.2 complete and gate-verified. 1.3-1.7 blocked.**

Gate result for the 1.1/1.2 slice, run 2026-07-29:

| Command                                       | Result                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                           | exit 0                                                                                                                                            |
| `npm run test:ci`                             | 139 suites / **1675 tests** passed (baseline in Deviation 3 was 136/1631 — the delta is the concurrent session's new unit tests, not this tier's) |
| `npm run validate:all`                        | exit 0, 11 members                                                                                                                                |
| `npm run lint:ratchet`                        | exit 0 — 3487 errors / 1437 warnings, **no regressions**                                                                                          |
| `npm run lint:ratchet:baseline`               | **DELIBERATELY NOT RUN** — see below                                                                                                              |
| `test:integration -- gate-category-selection` | 16/16 green                                                                                                                                       |

**Why `lint:ratchet:baseline` was withheld.** It _writes_ the baseline. With 61 dirty files from a
concurrent session in the tree, running it would bake that session's un-reviewed lint state into
the committed baseline — silently raising the ceiling for work this tier never touched. The
non-mutating `lint:ratchet` passing is what the gate is actually asking (no regression from this
tier), and it passed. Run `lint:ratchet:baseline` only when the tree is clean and the counts have
genuinely moved.

**Blocking chain for 1.3-1.7**: 1.3-1.6 depend on **0.3** (`server/knip.json`), which depends on
**0.1** (commit + branch cut), which is halted by Deviation 2. 1.7 depends on 1.2-1.6. This
ordering is the Untrusted Inventory diagnosis doing its job — 1.3's verification is _"`npx knip` no
longer lists them"_, and an unconfigured knip reports 57 unused files. Deleting against that
report is deleting against a number nobody has audited.

### Tier 2: Collapse barrels BEFORE renames.

| ID  | Status | Step                                                                                                                                                                                                                                                                                                                                                                               | Files                                                                                                        | Depends                              | Verification                                                                                                                                                                                   |
| --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | ✓      | Classified all **24** knip-flagged barrels with a written reason — see Barrel audit below. **Dependency on 1.7 dropped, see Deviation 7**                                                                                                                                                                                                                                          | (audit)                                                                                                      | 0.3                                  | **DONE** — 24/24 carry a verdict, zero unclassified; verdicts corroborated by independent path resolution, not taken from knip alone                                                           |
| 2.2 | ✓      | **Option A ruled by operator 2026-07-29**: convention amended, then 22 barrels deleted. Plan named 5; audit found 24; 22 deleted, 2 held as ESCALATE (dead subtrees). **Pure deletion — zero importer rewrites**, proven before acting                                                                                                                                             | 22 files per audit table; `CLAUDE.md:106`                                                                    | 2.1, ~~1.7~~ (no importers to guard) | **DONE** — typecheck 0, build 0, `validate:all` 0, `lint:ratchet` 0, test:ci 1696 passed, `validate:arch` 0 errors. Modules **461 → 439** (−22 exactly); knip unused **56 → 34** (−22 exactly) |
| 2.3 | ✓      | Removed **9** compat re-exports: 3 whole shim files (`chains/chain-session-store.ts`, `chains/types.ts`, `observability/metrics/types.ts` — 7 consumers repointed to canonical) + 6 zero-consumer re-export symbols (`PromptsConfig`; `CustomCheck`/`GateScope`/`GateSpecification`/`ChainStep`/`GateReviewExecutionContext`). **Remainder deferred to Tier 3 — see Deviation 11** | `modules/chains/*`, `infra/observability/metrics/*`, `modules/prompts/types.ts`, `engine/execution/types.ts` | 2.2                                  | **DONE** — typecheck 0, build 0, `validate:all` 0, `lint:ratchet` 0, 1696 tests pass. Exactly **1** pure re-export shim remains repo-wide (`src/types.ts`, allowlisted in 2.4)                 |
| 2.4 | ✓      | **NEW** guard forbidding cross-layer compat re-exports                                                                                                                                                                                                                                                                                                                             | `scripts/validate-no-crosslayer-reexport.js`                                                                 | 2.3                                  | Exits 0 now; exits 1 against a deliberately reintroduced alias                                                                                                                                 |
| 2.5 | ✓      | Register 2.4 as a script + append to `validate:all`                                                                                                                                                                                                                                                                                                                                | `package.json`                                                                                               | 2.4                                  | `npm run validate:all` runs 15 members, exits 0                                                                                                                                                |

**Gate**: `npm run typecheck && npm run test:ci && npm run validate:all && npm run validate:arch && npm run lint:ratchet:baseline`

**Tier 2 status: 1 of 5. 2.1 complete. 2.2-2.5 blocked — one blocker is a decision, not a dependency.**

#### Barrel audit (step 2.1, 2026-07-29)

**Method.** knip's verdict was not taken on trust. Every import in `src/` and `tests/` was resolved
to an absolute path and the reverse-edge graph rebuilt independently
(`scratchpad/barrel-audit{,2}.mjs`). Grep cannot answer this: `from './services/index.js'` and
`from '../../gates/services/index.js'` name the same file, and `.../core/index.js` aliases across
four different tool directories — a naive two-segment match reports 8 importers for each of the
four, all of them the same 8 files.

One gap in that method was found and closed: `tsconfig.json` declares five path aliases
(`@shared/*`, `@infra/*`, `@engine/*`, `@modules/*`, `@mcp/*`) and `jest.config.cjs:47-51` mirrors
them, none of which a relative-only resolver would follow. Probe: `rg "from '@(shared|infra|engine|modules|mcp)/" src tests` →
**0 matches**. The aliases are used by nothing, so the resolver was complete. _(That is itself a
finding — see New findings below.)_

Independent resolution agrees with knip on all 24. Two tools, two methods, same answer.

**Verdicts.** `SIB` = sibling modules in the barrel's directory. `REACHED` = siblings that live
code imports directly, bypassing the barrel.

| Barrel                                                  | SIB | REACHED | Verdict                        | Reason                                                                                                                                                                                                                           |
| ------------------------------------------------------- | --- | ------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine/execution/capture/index.ts`                     | 1   | 1       | DELETE                         | 3 lines re-exporting `StepCaptureService`, which every consumer already imports directly                                                                                                                                         |
| `engine/execution/delegation/index.ts`                  | 3   | 3       | DELETE                         | all three modules directly imported; barrel adds a second path to the same symbols                                                                                                                                               |
| `engine/execution/formatting/index.ts`                  | 2   | 2       | DELETE                         | same                                                                                                                                                                                                                             |
| `engine/execution/operators/index.ts`                   | 2   | 2       | DELETE                         | same                                                                                                                                                                                                                             |
| `engine/execution/pipeline/state/index.ts`              | 1   | 1       | DELETE                         | same                                                                                                                                                                                                                             |
| `engine/execution/pipeline/state/accumulators/index.ts` | 2   | 2       | DELETE                         | only importer is `state/index.ts`, itself dead — interior node of a dead chain                                                                                                                                                   |
| `engine/frameworks/index.ts`                            | 3   | 3       | DELETE                         | root of a 3-barrel dead chain (`integration/`, `utils/`)                                                                                                                                                                         |
| `engine/frameworks/utils/index.ts`                      | 4   | 4       | DELETE                         | only importer is `frameworks/index.ts`                                                                                                                                                                                           |
| `engine/gates/index.ts`                                 | 4   | 4       | DELETE                         | root of the gates barrel chain; imports `./core/`, `./services/`                                                                                                                                                                 |
| `engine/gates/judge/index.ts`                           | 4   | 4       | DELETE                         | all 4 modules directly imported                                                                                                                                                                                                  |
| `engine/gates/services/index.ts`                        | 13  | 13      | DELETE                         | largest — 13 siblings, all 13 directly imported; only importer is `gates/index.ts:31`                                                                                                                                            |
| `mcp/contracts/schemas/index.ts`                        | 2   | 2       | DELETE                         | both directly imported                                                                                                                                                                                                           |
| `mcp/metadata/definitions/index.ts`                     | 4   | 4       | DELETE                         | same                                                                                                                                                                                                                             |
| `mcp/tools/framework-manager/core/index.ts`             | 3   | 3       | DELETE                         | same                                                                                                                                                                                                                             |
| `mcp/tools/gate-manager/core/index.ts`                  | 3   | 3       | DELETE                         | same                                                                                                                                                                                                                             |
| `mcp/tools/prompt-engine/core/index.ts`                 | 5   | 5       | DELETE                         | same                                                                                                                                                                                                                             |
| `mcp/tools/resource-manager/core/index.ts`              | 2   | 2       | DELETE                         | same                                                                                                                                                                                                                             |
| `modules/automation/detection/index.ts`                 | 1   | 1       | DELETE                         | same                                                                                                                                                                                                                             |
| `modules/automation/execution/index.ts`                 | 3   | 3       | DELETE                         | same                                                                                                                                                                                                                             |
| `modules/automation/index.ts`                           | 1   | 1       | DELETE                         | 148 lines — the largest barrel in the set, and it carries the `@deprecated ExecutionMode` re-export that Tier 1 step 1.5 targets                                                                                                 |
| `modules/hot-reload/index.ts`                           | 2   | 2       | DELETE                         | both directly imported                                                                                                                                                                                                           |
| `shared/core/index.ts`                                  | 0   | 0       | **DELETE (different reason)**  | contains no siblings at all — 8 lines whose entire body is `export * from './resource-manager/index.js'`. A barrel over a barrel                                                                                                 |
| `engine/frameworks/integration/index.ts`                | 1   | **0**   | **ESCALATE — not 2.2's scope** | DEAD SUBTREE. Its sole sibling `framework-semantic-integration.ts` is _also_ unreachable. Marked `@lifecycle migrating — "under phased rollout"`. A rollout that never rolled out; deleting it removes a subsystem, not a barrel |
| `infra/observability/performance/index.ts`              | 1   | **0**   | **ESCALATE — not 2.2's scope** | DEAD SUBTREE. Sole sibling `monitor.ts` (`PerformanceMonitor`) also unreachable. Deleting it removes performance monitoring outright — that is a product decision                                                                |

**Tally: 22 DELETE · 2 ESCALATE · 0 KEEP · 0 unclassified.**

##### Convention conflict — this is a decision, not a dependency

Project `CLAUDE.md` states: _"Module organization: <=7 files flat + barrel, >7 files use `internal/`
subfolder."_ Read literally, barrels are **required** by the handbook — and 22 of the 24 sit in
directories with ≤7 files, exactly where the rule says a barrel belongs.

So the codebase is not in violation of its convention; it is following a convention nothing
consumes. Deleting all 22 conflicts with the handbook. Three coherent resolutions, and picking one
is the operator's call:

| Option                                                         | Consequence                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A — delete the 22, amend the convention**                    | Handbook stops mandating barrels. Import paths get longer but there is exactly one path to each symbol. Largest diff                                                                                                                                         |
| **B — keep the barrels, remove them from the knip signal**     | Convention intact, but 24 permanent entries in the dead-code report train everyone to ignore it — the report stops working as a signal                                                                                                                       |
| **C — delete only where a barrel also carries compat aliases** | Smallest diff, targets the actual shim debt. `modules/automation/index.ts` (148 lines, `@deprecated ExecutionMode`) and `shared/core/index.ts` (barrel-over-barrel) qualify; most of the other 20 are honest 3-9 line re-export files that are merely unused |

**Nothing is deleted until this is answered.** The tier heading says "Collapse barrels BEFORE
renames", which presumes option A without ever having stated it as a choice.

##### New findings (not in the original plan)

1. **Five dead path aliases.** `tsconfig.json:24-30` declares `@shared/@infra/@engine/@modules/@mcp`
   and `jest.config.cjs:47-51` mirrors all five in `moduleNameMapper`. **Zero import sites use any
   of them.** Same defect class as the dead barrels: declared infrastructure with no consumer,
   duplicated across two config files that must be kept in sync for no benefit.
2. **knip confirms Tier 1's targets independently.** Its `Duplicate exports` section reports
   `modules/chains/manager.ts: createChainSessionStore, createChainSessionManager` and
   `ChainSessionStore, ChainSessionManager` — the exact pairs step 1.4 targets, found by a second
   tool via a different method.
3. **A dual-vocabulary pair the plan missed**: `mcp/tools/index.ts: createMcpToolRouter,
createMcpToolsManager` — also flagged as a duplicate export. Belongs in Tier 3's scope.
4. **`ajv` is a false lead.** knip reports it as an unused dependency, but its sole importer is
   `infra/config/config-schema-validator.ts`, which is itself dead. The dependency finding is
   downstream of the dead file — remove the file and `ajv` follows. Do not remove `ajv` on its own.
5. **A stale duplicate script**: `scripts/validate-methodologies.js` is unreferenced while
   `package.json:80` invokes `scripts/validate-methodologies.ts` via tsx. Both exist; one is dead.

##### Why 2.3-2.5 did not run

Strictly chained: 2.3 depends on 2.2, 2.4 on 2.3, 2.5 on 2.4. With 2.2 blocked the rest cannot
start. Independently, 2.2/2.3 rewrite importers across `engine/execution/**` — where the concurrent
session holds uncommitted edits to `execution-planner.ts` (-265 lines), `category-extractor.ts`
(-280 lines), and four pipeline stages. Rewriting import paths under those files is the
"not safe, not non-destructive" case, regardless of the convention ruling.

### Tier 3: Vocabulary unification. ONE vocabulary per commit. Gated on 0.5.

| ID   | Status | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Files                                                                                                                               | Depends  | Verification                                                                                                        |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --- | ------------------------------------------------------------------------- |
| 3.1  | ✓      | `StepState` → `StepLifecycle` — **DONE 2026-07-30** (deferred, then executed same day on operator request). Not a rename — enum→union+substate-flags data-model migration touching persisted `chain_run_registry` shape. Full context, site inventory and execution order: [`stepstate-lifecycle-migration.md`](./stepstate-lifecycle-migration.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `shared/types/`, `modules/chains/manager.ts`, `engine/execution/capture/`, `infra/database/`                                        | 0.5      | **DONE** — typecheck 0, 1696 tests, `validate:all` 0, `validate:arch` 0, `build` 0                                  |
| 3.2  | ✓      | **DONE** — `scripts/validate-no-stepstate.js` added + registered; `validate:all` now **17** members; negative-tested both directions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `scripts/validate-no-stepstate.js`, `package.json`                                                                                  | 3.1      | **DONE** — `validate:all` 17 members, exits 0                                                                       |
| 3.3  | ✓      | `ChainSessionManager` → `ChainSessionStore` (**177**→0, not 143) incl. lowercase `chainSessionManager`. 33 files + test file renamed `chain-session-manager.test.ts` → `chain-session-store.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `src/`, `tests/`, `docs/` (no `hooks/` hits)                                                                                        | 3.2      | **DONE** — residual 0; typecheck 0, 1696 tests, `validate:all` 0, `validate:arch` 0                                 |
| 3.4  | ✓      | **NEW** guard + registration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `scripts/validate-no-chainsessionmanager.js`, `package.json`                                                                        | 3.3      | **DONE** — `validate:all` **16 members**, exits 0; guard negative-tested (reintroduce → exit 1)                     |
| 3.5  | ⊘      | **NOT EXECUTED — premise false (2026-07-30).** Measured **827** hits, not 336. `handoff` does exist (94 hits), so the row was right that both words are present — but they are **layered, not competing**: `delegation*` names the mechanism (`DelegationPayload`, `DelegationProfile`, `DelegationStrategy`, `DelegationRenderer`) and `handoff` names the agent-facing text it emits (`getHandoffFooterPrefix` returns `'Handoff via Task tool'`; `buildHandoffSection` produces the `⚡ HANDOFF:` CTA). No type is ever `Handoff`-prefixed. The docs already encode the split correctly: `                                                                                                                                                                                                                             | Delegation                                                                                                                          | ==>      | Hand off step to sub-agent                                                                                          | `. Collapsing them loses the ability to say which is meant, and would break `identity.launchDefaults.delegationProfile`, a key in `CONFIG_VALID_KEYS`. Original step: `delegat*`→`handoff*` | `src/`, `tests/`, `hooks/`, `docs/` | 3.4 | `rg -ci "delegat" src tests hooks docs` = 0 or survivors justified inline |
| 3.6  | ⊘      | **FALLS WITH 3.5.** A guard banning `delegat*` would ban the domain vocabulary that should stay. Original step: NEW guard + registration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `scripts/validate-no-delegation-vocab.js`, `package.json`                                                                           | 3.5      | `npm run validate:all` exits 0                                                                                      |
| 3.7  | ✓      | **ALREADY DONE, and done better than this row specified.** `mode` does not map to `trigger` — it maps to **two** fields: `mode: manual → trigger: explicit`, `mode: confirm → confirm: true`, `mode: auto → default`. `script-schema.ts` already carries `trigger: TriggerTypeSchema` as canonical plus a `.transform()` that folds the deprecated `mode` forward and logs a deprecation warning. Executing this row as written would have collapsed `confirm` into `trigger`. Its verification (`rg -c "\bmode\b" src/modules/automation` = 0) is unreachable by design — the 57 survivors are the fold and its docs. Original step: `mode` → `trigger`, automation scope only                                                                                                                                           | `src/modules/automation/**`, `src/shared/types/automation.ts`                                                                       | 3.6      | `rg -c "\bmode\b" src/modules/automation` = 0                                                                       |
| 3.8  | ✓      | **DONE 2026-07-30** (after 3.11 unblocked it). A guard banning `mode` in automation would have to allowlist `ExecutionModeService` / `ExecutionModeServicePort` / `ExecutionModeFilterResult` — i.e. exempt exactly what 3.11 removes. Write it after 3.11, not before. NEW guard + registration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `scripts/validate-no-execution-mode.js`, `package.json`                                                                             | 3.7      | `npm run validate:all` exits 0                                                                                      |
| 3.9  | ✓      | **DONE 2026-07-30.** All four stages ran (stage 2 ruling, stage 3 and stage 4 outcomes recorded below), and the residual contract surface was finished by Tier 5. `validate:no-methodology-vocab` now passes, so the remaining hits are allowlisted folds with retirement conditions rather than open work. Marked ◐ until the guard existed to prove it. **DIRECTION REVERSED** by operator 2026-07-30: unify on **`framework`**, not `methodology`. Stage 1 of 4 — 602 replacements / 68 files across the **72 non-colliding** tokens, plus 189 YAML field renames (`methodologyBasis`→`frameworkBasis` etc.) in 19 resource files                                                                                                                                                                                      | `src/`, `tests/`, `resources/**/*.yaml`                                                                                             | 3.8, 0.5 | **STAGE 1 DONE** — typecheck 0, 1696 tests, `validate:all` 0, `validate:arch` 0, `lint:ratchet` 0. Stages 2-4 below |
| 3.10 | ⊘      | **SUPERSEDED BY 5.8.** Blocked here because a zero-tolerance guard could not pass — the surface was ~1658 hits. Passes 1-5 took it to 418, all of it contract surface, so the guard is now writable but must **allowlist** rather than demand zero. Do not implement both rows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `scripts/validate-no-methodology-vocab.js`, `package.json` (name corrected 2026-07-30 — the pass-5 sweep had inverted it)           | 3.9      | n/a — see 5.8                                                                                                       |
| 3.11 | ✓      | **NEW, replaces the residual half of 3.7.** The _data_ migration is done; the **names** still describe the retired model. `ExecutionModeService`, `ExecutionModeServicePort`, `ExecutionModeFilterResult`, `ExecutionModeServiceConfig` and `execution-mode-service.ts` all name auto/manual/confirm filtering that no longer exists — the file's own comment says "The old mode-based filtering (auto/manual/confirm) has been replaced". **124 sites / 16 files / 8 symbols.** ⚠️ **HOMONYM**: `CommandExecutionMode = 'single'\|'chain'\|'auto'\|'prompt'\|'template'` in `shared/types/metrics.ts` is an unrelated concept — a blind `ExecutionMode` rename corrupts metrics. Name the behaviour, not the retired field: the service partitions detected tool matches into immediately-runnable vs needs-confirmation | `modules/automation/execution/`, `shared/types/{index,automation,metrics}.ts`, `stages/04b-script-execution-stage.ts`, 5 test files | 3.7      | Metrics `CommandExecutionMode` untouched; `validate:all` 0; unblocks 3.8                                            |

#### Tier 3 outcome (2026-07-30)

Rows 3.5-3.8 + new 3.11 closed. **Two rows executed; two were refused on evidence.**

| Row                                          | Outcome                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.5 `delegat*` → `handoff*`                  | ⊘ **Not executed.** 827 hits, not 336 (**fifth falsified count**). Both words exist, but layered: `delegation*` = mechanism, `handoff` = the agent-facing text it emits. No type is `Handoff`-prefixed; the docs already say `\| Delegation \| ==> \| Hand off step to sub-agent \|`. Would have broken `identity.launchDefaults.delegationProfile` |
| 3.6 delegation guard                         | ⊘ Falls with 3.5 — would ban the vocabulary that should stay                                                                                                                                                                                                                                                                                        |
| 3.7 `mode` → `trigger`                       | ✓ Already done, and **not** as specified: `mode` maps to **two** fields (`manual → trigger: explicit`, `confirm → confirm: true`). Executing as written would have collapsed `confirm` into `trigger`                                                                                                                                               |
| 3.11 `ExecutionMode*` → `ToolTriggerFilter*` | ✓ 124 sites / 16 files / 8 symbols                                                                                                                                                                                                                                                                                                                  |
| 3.8 execution-mode guard                     | ✓ `validate:no-execution-mode`, `validate:all`'s **19th** member                                                                                                                                                                                                                                                                                    |

**3.11 naming.** `ExecutionModeService` filtered on a field that no longer exists — its own comment
said _"The old mode-based filtering (auto/manual/confirm) has been replaced"_. Renamed for the
behaviour: it partitions detected tool matches into runnable-now vs needs-confirmation.
`ExecutionModeService → ToolTriggerFilter`, `…Port/…Config/…FilterResult` likewise,
`filterByExecutionMode → filterByTrigger`, file → `tool-trigger-filter.ts`. `Gate` was rejected as
a name — that word is taken by the gates subsystem.

**Two symbol groups deliberately NOT renamed**, and the guard is scoped so it never sees them:

- `ExecutionModeSchema` / `ExecutionModeYaml` — correctly named, they parse the _deprecated_ `mode`
  field. They retire with the fold, not before.
- `CommandExecutionMode` (`'single'\|'chain'\|'auto'\|'prompt'\|'template'`) in
  `shared/types/metrics.ts` — an unrelated concept. A blind `ExecutionMode` sweep corrupts metrics.

**3.8 scope discipline.** `mode` is among the heaviest homonyms here (`gates.mode`,
`frameworks.mode`, `resources.mode`, `identity.mode`, enforcement mode, metrics). The guard checks
only `src/modules/automation` + `shared/types/automation.ts`. Verified in **three** directions:
exit 1 on an in-scope reintroduction, exit **0** on the same token planted in
`infra/observability/metrics/`, exit 0 clean.

**Verification.** typecheck 0, `lint:ratchet` 0 regressions, `validate:all` exit 0 with 19 members,
102 tests green across the touched suites, full suite 32 failures = HEAD baseline.

**Gate (after EVERY sub-step)**: `npm run typecheck && npm run test:ci && npm run validate:all && npm run validate:arch && rg -c "<retired-term>" src tests hooks docs && npm run lint:ratchet:baseline`

#### 3.9 direction ruling + staging (operator decision 2026-07-30)

**Unify on `framework`.** The premise the original step rested on was wrong: `methodology` is not
an internal-only term — it is a **public `resource_type` enum value**, a `methodology:` param, and
the on-disk `resources/methodologies/` directory. Both vocabularies were already public, so no
direction avoided touching the contract. Operator chose `framework` (2,317 internal sites vs 4,147
the other way) accepting the directory rename, on the basis that the project has no user base and
the only overlay exposure is the maintainer's own workspace.

**The bigger find: 7 pairs are DUPLICATE TYPES, not naming collisions.** `MethodologyState` and
`FrameworkState` are structurally identical — same 7 fields, same nested `switchingMetrics`. Both
sides of every pair have live consumers, with **mixed dominance**, so no bulk pick is correct:

| Retiring                                                                                                | uses   | Existing target             | uses   |
| ------------------------------------------------------------------------------------------------------- | ------ | --------------------------- | ------ |
| `MethodologyDefinition`                                                                                 | 16     | `FrameworkDefinition`       | **48** |
| `MethodologyRegistry`                                                                                   | **26** | `FrameworkRegistry`         | 1      |
| `MethodologyValidator`                                                                                  | 14     | `FrameworkValidator`        | **29** |
| `MethodologyValidationResult`                                                                           | **6**  | `FrameworkValidationResult` | 2      |
| `MethodologyState`                                                                                      | 3      | `FrameworkState`            | **6**  |
| `MethodologySwitchRequest`                                                                              | 3      | `FrameworkSwitchRequest`    | **4**  |
| `Methodology` / `Methodologies` / `MethodologiesConfig` / `MethodologyToolDescriptions` / `METHODOLOGY` | —      | counterparts exist          | —      |

This is deduplication work, not renaming. Each pair needs a structural diff, a canonical winner,
consumers repointed, and the loser deleted — one commit per pair.

| Stage | Scope                                                                                                                                                                        | Status                                                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1     | 72 non-colliding tokens (`src/`, `tests/`) + resource YAML field names                                                                                                       | **✓ DONE** — 602 + 189 replacements, full gate green                                                             |
| 2     | 7 colliding pairs adjudicated — **only 2 were duplicates**; see ruling below                                                                                                 | **✓ DONE** — 81 replacements / 27 files, typecheck 0, 1696 tests, `validate:all` 0, `validate:arch` 0, `build` 0 |
| 3     | On-disk resource dir + filenames + path constants (**3a**), then `resource_type` enum value, contracts, router, indexer, skills-sync, version-history discriminator (**3b**) | **✓ DONE** — 2 commits; all 8 frameworks verified loading from the new path; full gate green                     |
| 4     | `docs/`, `CLAUDE.md`, `>>create_methodology` prompt id, then `scripts/validate-no-methodology-vocab.js` + registration                                                       | **◐ 2026-07-30** — 7 commits; scope was badly understated, see below. Guard (3.10) BLOCKED                       |

#### Stage 4 outcome: it was not a docs pass — three live regressions came out of it

Stage 4 was written as "docs, CLAUDE.md, one prompt id, then a guard". Measuring first found
**three functional regressions the earlier stages had introduced and nobody had caught**, because
each fails silently:

| #   | Regression                                                                                                                                                                                                                                                                                                                                                                                                       | Root cause                                                      | Commit     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------- |
| 1   | `config.json` declared `resources.methodologies`; the loader reads `resources.frameworks`. The key was ignored and the default took over — a deliberate disable would have been undone with no error. `config.schema.json` still described the pre-rename shape.                                                                                                                                                 | Config shape binds at load time; `tsc` cannot see it.           | `39db8757` |
| 2   | **`cpm list methodologies -w server` returned "No methodologies directory found"** against the workspace it ships with. `cli/` is a separate package that was never in Stage 3a's scope, so `TYPE_CONFIG` still resolved `resources/methodologies/methodology.yaml`. Two config keys were dead too.                                                                                                              | Stage 3's "nothing was orphaned" check covered the server only. | `19f9d71b` |
| 3   | **All 8 frameworks contributed zero gates.** Stage 1 renamed the YAML key to `frameworkGates:` but `FrameworkSchema` still declared `methodologyGates`. The schema is `.passthrough()`, so the file parsed, the key survived on the object, and every typed consumer read `undefined`. Not display-only: `template-enhancer.ts:112` and `generic-methodology-guide.ts:201` build `FrameworkEnhancement` from it. | Same passthrough blind spot; no error at any layer.             | `280603e8` |

Then the planned work: `create_methodology` → `create_framework` (`7d1c32e6`, breaking), two tool
descriptions that named values the server rejects (`436e2d57` — `resource_type:"methodology"` in a
worked example, and skills-sync declaring `enum[...|methodology|...]` when `VALID_RESOURCE_TYPES`
takes `framework`), and ~40 doc instructions that no longer work (`62897a03`).

**A fourth failure, mine, mid-Stage-4**: the docs pass first "corrected" `resource://methodology/`
to `resource://framework/` without probing — but `RESOURCE_URI_PATTERNS` really did say
`methodology`, so the docs had been right. Renaming the constant was the smaller fix and matches
the `resource_type` enum, so that is what landed. The lesson is the compat-site audit's method
note verbatim: **substituting into prose without probing what the code says.**

> **3.10 (the guard) is BLOCKED, not skipped.** A `validate-no-methodology-vocab.js` cannot pass:
> **~1658 `methodolog*` hits remain in `server/src` + `tests`** — the `engine/frameworks/methodology/`
> directory itself, `methodology-file-writer.ts`, `methodology-hot-reload.ts`, `registry.ts`,
> `generic-methodology-guide.ts`, plus local identifiers throughout the pipeline. Stage 1's "72
> non-colliding tokens" was never the whole surface. Registering a guard that fails on day one is
> worse than none. Sequence: finish the internal identifier + file/directory rename, THEN guard.
>
> **Deliberately left, each with a reason:**
>
> | Left as-is                                   | Why                                                                                                                                                                     |
> | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | `gates.methodologyGates`                     | Live **config** key (`infra/config/index.ts:299`) with validators in 4 more files — a homonym of the framework-YAML field, not the same thing. Needs its own migration. |
> | `methodology_gates` / `methodology_elements` | `resource_manager` **contract parameters**. Renaming is a contract-layer job (schema → types → router → manager → service), not a resource rename.                      |
> | `FrameworkEnhancement.methodologyGates`      | Internal runtime model (`methodology-types.ts:168`), not a data contract.                                                                                               |
> | Conceptual prose in `docs/`                  | Renaming it while 1658 code identifiers still say `methodology` trades one divergence for another. Follows the identifier rename, not the other way round.              |
>
> **Also found, unrelated and pre-existing**: `cli/` declares no jest/ts-jest devDependency
> despite shipping `jest.config.cjs` and `tests/`, and **no CI workflow references `cli/` at all**.
> That is why regression #2 shipped silently. Also `cli` is missing from the commitlint scope enum,
> and `cpm validate --prompts` reports 2 invalid prompts (a duplicate `resume_variant_build`).

#### Internal rename, pass 2 (identifiers) — ✓ 2026-07-30

Sequenced by risk class after the operator chose "finish the internal rename first". Pass 1
(exported symbols) landed as `7d16376f`, taking 1616 → 1481. Pass 2 takes **1481 → 1102**:
379 identifier references across 61 files.

**The classification, not the substitution, was the work.** Of 91 distinct compound identifiers,
a cross-check against `resources/`, `tooling/`, `config.json` and `docs/` found only **9 that
appear in any data file**. Those 9 are the boundary; the other 82 are provably internal and
mechanically safe. Three more (`inspect_methodology`, `methodology_id`, `methodology_changed`)
were probed individually — the first two are MCP wire tokens (an `operation` label and an input
parameter, kept), the third had 3 internal references and **no consumer at all**, so it became
`framework_changed`. Pass 1 had protected it on suspicion; pass 2 had the evidence.

**Four identifiers could not take the blanket target name** — same-file collisions where the
naive rename would have collapsed two distinct concepts:

| Identifier                      | Naive target         | What it actually is                                                                                       | Renamed to            |
| ------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- | --------------------- |
| `activeMethodology`             | `activeFramework`    | The framework **type**; `activeFramework` on the same object is its **id**, read as `type ?? id`.         | `activeFrameworkType` |
| `totalMethodologies`            | `totalFrameworks`    | Counts **guides** (`getAllGuides()`), and `totalFrameworks` already sits beside it in the same interface. | `totalGuides`         |
| `methodologyKey`/`frameworkKey` | — (pair)             | Two lookup keys in one scope: overlays register each guide under **both** its type and its id.            | `typeKey` / `idKey`   |
| `frameworkMethodology`          | `frameworkFramework` | A local holding `selectedFramework?.type`.                                                                | `frameworkType`       |

The `activeMethodology` case is the one that mattered: `ToolDescriptionsConfig` carries both
fields and the lookup is `activeMethodology ?? activeFramework`. Merging them would have removed
the type-preferred/id-fallback behaviour silently — nothing would have failed to compile. The
duality is now documented on the interface, which is why it read as a duplicate in the first place.
It is runtime-only metadata: the generated `tool-descriptions.contracts.json` carries neither key,
which is what made the rename safe.

**Verification.** typecheck 0 · unit 1703/1703 · validate:all 0 · validate:arch 0 (2 pre-existing
warnings) · build 0 · ratchet 3476 (no regression). Integration/e2e measured **before and after on
the same tree: 11 suites / 34 tests failing in both, identical failure sets** — the pre-existing
Tier-IT backlog, unmoved. All 8 frameworks validate; the server boots over STDIO and registers all
three tools. Every protected token was count-compared against `HEAD` and is unchanged.

> **Two probes of mine were falsified mid-pass, both caught before they did damage.** The
> collision detector reported zero same-file collisions when `mcp/tools/index.ts` demonstrably
> contained both names — a `comm` invocation that silently produced nothing. And the generated
> `sed` script had every `\b` converted to a literal backspace byte by `echo`, so the first
> "successful" run replaced nothing while reporting 59 files touched. The count check
> (`1481` unchanged) is what exposed it. **A rename that reports success is not evidence it ran.**

> **Also found**: `npm run generate:schemas` writes raw `JSON.stringify(…, 2)` while the committed
> schemas are prettier-formatted, so every regeneration dirties `methodology.schema.json` with
> formatting-only churn and every commit collapses it back. Harmless today, but it makes any
> staleness check on that file unreliable. Not fixed here — it is not a rename.

**Remaining**: 1102 hits — comment/doc prose (pass 3), 12 file + 2 directory renames (pass 4),
then the guard (pass 5).

#### Internal rename, pass 3 (comment prose) — ✓ 2026-07-30

**1102 → 626.** 468 of 488 full-line comments plus 6 trailing comments, across 97 files.
Committed as `4c493402` for pass 2 first, so this diff is prose-only and reviewable on its own.

Two categories were masked rather than renamed, and the distinction is the whole design of the
transform: a comment may legitimately **name** something that must not change.

| Masked                                                                                                                                                       | Why                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `methodology_gates`, `methodology_elements`, `methodologyGates`, `methodology_compliance`, `enableMethodologyGates`, `methodology_id`, `inspect_methodology` | Config keys, MCP parameters and gate `pass_criteria` values. Prose describing them still has to spell them correctly. |
| `methodology-schema.ts`, `methodology-types.ts`, and the other 10 filenames                                                                                  | Pass 4 moves these. Renaming a `@see` target before the file moves points it at nothing.                              |

Masking is per-token, not per-line, so a line like
``* - `methodology_compliance`: enforced by methodology phase guards`` renames the prose and
keeps the token: **20 comments remain and every one of them is a deliberate reference** to a
protected token or a not-yet-moved filename.

**Three defects the pass surfaced, each fixed on the spot:**

1. **"framework framework"** in 13 places. Earlier stages had already renamed the adjective but
   not the noun ("framework methodology guidance"), so a correct substitution produced a doubled
   word. Confirmed absent at `HEAD` before fixing, so all 13 were mine.
2. **A doc example was falsified by its own rename.** `getYamlBaseName('methodology.yml') //
'methodology'` had the _expected return value_ renamed while the input stayed, making the
   example wrong. Changed to `('framework.yaml') // 'framework'` — consistent and current.
3. **Pass 2's identifier regex required lowercase `methodolog`, so ALL-CAPS never matched.**
   `OPTIONAL_METHODOLOGY_FIELDS` (module-local, 2 references, absent from every data file) was a
   pass-2 miss and is folded in here as `OPTIONAL_FRAMEWORK_FIELDS`.

> **Newly deferred**: `{METHODOLOGY}` is a **prompt-template placeholder** substituted with
> `framework.type` (`prompt-guidance/service.ts:288`). No shipped resource or doc uses it, but a
> workspace template could, so it is an authoring-facing token, not prose. It is also already
> inconsistent with its neighbour `{FRAMEWORK_NAME}` — the natural target is `{FRAMEWORK_TYPE}`,
> which makes it a contract-layer change alongside `methodology_gates`, not a rename.

**Verification**: typecheck 0 · unit 1703/1703 · validate:all 0 · validate:arch 0 · build 0 ·
ratchet 3476 unchanged · integration/e2e 11 suites / 34 tests, still the untouched baseline. The
diff was checked line-by-line to contain **no non-comment changes** beyond the 6 known trailing
comments, whose code portions are byte-identical.

**Remaining**: 626 hits — 554 code/string (protected tokens and path literals), 52 import paths,
20 protected comments. Pass 4 (12 files + 2 directories) claims the import paths; the guard follows.

#### Internal rename, pass 4 (files + directories) — ✓ 2026-07-30

**626 → 569.** 19 files and 2 directories moved with `git mv` (history preserved), import paths
rewritten across 47 files, plus one npm script rename. **No `methodology`-named file or directory
remains anywhere under `src`, `tests`, or `scripts`.**

**The directory is `definitions/`, not `framework/`.** A literal substitution gives
`frameworks/framework/framework-schema.ts` — stuttering, and the only sibling named after the
domain object rather than its role (`integration/`, `phase-guards/`, `prompt-guidance/`, `types/`,
`utils/`). The contents are the schema, definition types, runtime loader, registry, generic guide
and hot-reload coordinator: _how a framework definition gets loaded and registered_. Operator call.

**Filenames follow the symbol, not the token.** Each file was renamed after its primary export
rather than by substitution, which caught one trap: `methodology-validator.ts` exports
`FrameworkDraftValidator` (stage 2 gave it that name because it scores an authoring draft, unlike
`FrameworkValidator` which resolves ids). Substituting would have produced a second
`framework-validator.ts` — recreating precisely the homonym this sweep exists to remove. It is
`framework-draft-validator.ts`.

**`server/scripts/` was outside passes 2 and 3 — the third instance of the same miss** (after the
CLI in stage 4 and the contract JSON in stage 3). Both renamed scripts still carried
`METHODOLOGIES_DIR`, `validateMethodology`, `methodologyJsonSchema` and stale prose; the generator
was also writing `"title": "Methodology Definition"` into the IDE-facing schema. Folded in here.
`METHODOLOGIES_DIR` is another ALL-CAPS identifier of the class pass 2's regex could not see.

**"framework framework" recurred twice more** — once in `generate-gate-index.js`, once inside the
schema generator's own description string, where it surfaced only after regenerating and reading
the output diff. Fixed at the source, not in the generated file.

> **The barrel question, answered against the code rather than the rule.** `CLAUDE.md` says "no
> barrel/`index.ts` re-export files", which reads as a blanket ban. The **enforced** guard
> (`validate-no-crosslayer-reexport.js`) says the opposite in its own header: _"Deliberately NOT
> flagged: … a barrel with no compat marker. The marker is what distinguishes 'kept so old imports
> still resolve' from 'this is the module's public surface'."_ `src/` holds **60 `index.ts` files
> and only 6 carry a compat marker**. What is banned is the _compat shim_, not the barrel.
> `definitions/index.ts` has no marker and stays. **Action: the CLAUDE.md wording overstates the
> rule and should be corrected to say "no compat re-export shims" — a doc fix, not a code change.**

> **A verification probe of mine was vacuous in passes 2 and 3.** I compared integration failure
> _name sets_ before/after using `grep "✕"`, which emits nothing unless jest runs `--verbose` — so
> both sides were empty files and `comm` dutifully reported "identical". The **counts** in those
> passes were real evidence and are unaffected; the name-set claim was not evidence at all. Pass 4
> re-ran it against the `●` summary lines, which do parse: **34 baseline vs 34 after, zero newly
> broken, zero fixed.** Two probes falsified in pass 2, one here — the pattern is that a probe
> returning "no differences" needs its non-empty output checked before the result is believed.

> **One integration test is flaky**, oscillating the failure count between 33 and 34 across
> identical runs (observed 4×). Not introduced here — it explains the 12/35 reading in pass 2 that
> a re-run resolved to 11/34. Worth pinning, but it belongs with the Tier-IT backlog.

**Verification**: typecheck 0 · unit 1703/1703 · validate:all 0 (incl. the renamed
`validate:frameworks` member) · validate:arch 0 · build 0 · ratchet 3476 after fixing the +5
`import/order` and +1 `prettier` regressions the path rewrites caused, fixed on the 54 touched
files only so ratchet movement stayed attributable. Behavioural: server boots over STDIO and
registers all three tools; **`cli/` rebuilds and lists all 8 frameworks** — the package with no CI
and no test deps, whose blind spot shipped regression #2. Both renamed npm scripts run.
`docs/architecture/overview.md` had one row invalidated by the moves and was corrected; a sweep
confirmed no other doc, README, CHANGELOG or workflow references a moved path.

**Remaining**: 569 hits, and the character of what is left has changed completely — it is no
longer vocabulary. `methodology_gates` (53), `methodologyGates` (36), `methodology_elements` (22),
`methodology_id` (6), `methodology_compliance` (6) are contract/config surface; bare `methodology`
(344) is dominated by the `'methodology'` resource-type literal in SQLite and MCP registration,
test fixture data, and `rename-symbols.ts`'s historical record. **The guard (pass 5) can now be
written, but it must allowlist the contract surface rather than demand zero.**

#### Internal rename, pass 5 (whole repo) — ✓ 2026-07-30

The first pass measured the **whole repository** rather than `server/src`, and the number was
**1418, not 569** — passes 1-4 had been scoped to a subtree the whole time. Final: **1418 → 447**.

**Five live defects, none of them cosmetic.** The rename was the thing that surfaced them:

| #   | Defect                                                                                                                                                                                                                                                      | Why nothing caught it                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **The Python hook read a column value that never existed.** `db_reader.py` queried `resource_index WHERE type = 'methodology'`; the indexer writes `'framework'` (`IndexedResourceType`). `get_valid_frameworks_from_db()` returned `[]` on every call.     | Cross-language: Python reading SQLite written by TypeScript. No TS tooling can see it, and `except sqlite3.Error: return []` swallows failure. **Worse, the callers are fail-open** — an empty list reads as "DB unavailable", so `@framework` validation silently degraded to no validation rather than erroring. Verified against a live `state.db`: old query 0 rows, fixed query all 8 frameworks. |
| 2   | **5 shipped framework YAMLs advertised a `resource_type` the server rejects.** Their `toolDescriptions` overlays told the model to call `resource_manager(resource_type:"methodology")` while the Zod enum is `['prompt','gate','framework','checkpoint']`. | These overlays _replace_ the base description when their framework is active, so CAGEERF — the default — actively misdirected. Stage 4 fixed this exact defect in the contract JSON; the YAML overlays were never in scope.                                                                                                                                                                            |
| 3   | **A runtime user-facing message advertised the same rejected value** (`framework-discovery-processor.ts`), shown precisely when a user has no frameworks and needs the command to work.                                                                     | Message strings are invisible to every check in the suite.                                                                                                                                                                                                                                                                                                                                             |
| 4   | **`server/README.md` documented five environment variables that are read nowhere** (`MCP_PROMPTS_PATH`, `MCP_METHODOLOGIES_PATH`, `MCP_GATES_PATH`, `MCP_SCRIPTS_PATH`, `MCP_STYLES_PATH`) and omitted the live `MCP_RESOURCES_PATH`.                       | Only `MCP_METHODOLOGIES_PATH` was in rename scope, but fixing one row and leaving four identically-dead ones would document a lie more neatly. Table corrected.                                                                                                                                                                                                                                        |
| 5   | **Two doc examples passed an invalid `GateSource`.** `addAll(methodologyGates, "methodology")` / `"framework"` — neither is in the union; the valid value is `'framework-guide'`.                                                                           | Pass 5 initially changed `"methodology"` → `"framework"`, making it _plausibly_ wrong rather than fixing it. Caught on audit.                                                                                                                                                                                                                                                                          |

**The sweep nearly shipped its own worst regression.** Running the masked transform over `src`
inverted the legacy config migration: it read and deleted the **new** key instead of the legacy
one, and the second block became `delete legacyResources.frameworks` unconditionally — wiping
`resources.frameworks` for every user. `tsc` caught the first block only through a cast mismatch
and **could not see the second at all**. Worse, the same sweep neutered the guard test written in
the `bb1f590a` follow-up: it now wrote `frameworks:` and asserted `config.frameworks` was
undefined. **The regression and its test broke together.** Both reverted; the guard test passes 5/5.

> **The lesson is not "mask better".** It is that a whole-file automated substitution cannot be
> applied to files where the token is _semantically load-bearing on both sides of an assignment_.
> A back-compat migration reads the old name and writes the new one, so any rename of "the old
> name" destroys it by construction. Those files must be edited by hand, and the sweep must be run
> **before** hand-edits, never after — it rewrote my own freshly-written comments into
> self-contradictions twice (`gate.yaml`, `db_reader.py`).

**Three `methodologyGates` homonyms**, finally separated: the **config key** `gates.methodologyGates`
(6 sites, on-disk), the **YAML deprecated alias** (`framework-schema.ts`, deliberate fold-forward),
and the **runtime model field** `FrameworkEnhancement.methodologyGates` — internal, renamed to
`frameworkGates`. `enhancementMetadata.methodology` holds `this.type` and became `frameworkType`.

**`GatePassCriteriaSchema.methodology` → `framework`** is a real data-key rename. No shipped gate
uses it and the docs already documented it moving, but it gets the same fold-forward the framework
YAML got, plus `tests/unit/gates/pass-criteria-framework-fold.test.ts` (3 tests, negative-verified:
1 fails with the transform removed). Pinning it because the identical `.passthrough()` silent-loss
already shipped once as regression #3.

**Deleted, not renamed: `server/graphs/*.dot`** (314 hits, 8 tracked files). Last touched
2026-01-07, they cite `src/frameworks/...` — a layout that stopped existing at the 5-layer
migration. Nothing references them and no script regenerates them. Renaming would have made a
seven-month-stale artifact _look_ current.

**Verification**: typecheck 0 · unit **1706/1706** (3 new) · validate:all 0 · validate:arch 0 ·
build 0 · ratchet 3476 · `validate:readme` 0. Integration compared with vocabulary normalised on
both sides, since renaming test descriptions makes a naive diff report ten fake regressions:
**zero newly broken, and two genuinely fixed** — the `ResourceIndexer` tests asserting
`'methodology'` against an indexer that writes `'framework'`. Pre-existing failures **34 → 32**.

**Remaining 447, all deliberate**: `plans/` (155) and `CHANGELOG.md` (15) are the historical record
of this sweep; `remotion/` (35) is a separate tutorial-video app with its own build, absent from CI,
whose `SCRIPT.md` is spoken narration; `server` (234) is contract surface —
`methodology_gates`/`methodology_elements` (the `framework_builder` authoring payload),
`methodology_compliance` (a gate `pass_criteria` value), `gates.methodologyGates` (config),
`{METHODOLOGY}` (a prompt-template placeholder), the two deliberate back-compat folds, and
`scripts/rename-symbols.ts`'s record of past renames.

> **The guard should not demand zero.** Every one of those 234 is load-bearing. A useful
> `validate-no-methodology-vocab.js` allowlists the contract surface by exact token and fails on
> anything else — which is now a small, stable list rather than the moving target it was at 1658.

#### Stage 2 ruling: the "7 duplicate pairs" framing was wrong

Adjudicated by structural diff, not by name. The collision set splits three ways, and treating it
as one bucket would have merged unrelated concepts:

**Dead — deleted, not merged (2).** `MethodologyState` and `MethodologySwitchRequest` had **zero
real consumers**: a definition plus two re-export lines each. `MethodologyState` was field-for-field
identical to `FrameworkState`, which is the one actually wired to the state store.

**Homonyms — given DISTINCT names, must NOT be merged (3).** Same name shape, different concept:

| Retired name                  | Renamed to                       | Why not merged into the `Framework*` counterpart                                                                                                                                                                                                              |
| ----------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MethodologyValidationResult` | `FrameworkDraftValidationResult` | It is a **quality score** (`valid`, `level`, `score`, `errors`, `warnings`, `nextStep`). `FrameworkValidationResult` is an **id resolution** (`normalizedId`, `definition`). Unrelated.                                                                       |
| `MethodologyValidator`        | `FrameworkDraftValidator`        | Scores an authoring draft against an 80% field threshold. `FrameworkValidator` normalizes and resolves framework ids. Different jobs.                                                                                                                         |
| `MethodologyDefinition`       | `FrameworkResourceDefinition`    | The **on-disk YAML resource** (`systemPromptGuidance`, `gates`, `version`, `enabled`). `FrameworkDefinition` is the **runtime model** (`systemPromptTemplate`, `executionGuidelines`, `applicableTypes`, `priority`). Different shapes, different lifecycles. |

**Not a collision at all (2).** `MethodologyRegistry` -> `FrameworkRegistry` was safe: the target
appeared **only inside a doc comment**, never as a symbol. This also satisfies the 0.5 naming
ruling. `MethodologyToolDescriptions` -> `FrameworkToolDescriptions` was safe: the apparent target
was a _file-local, non-exported_ alias in `resource-manager/core/types.ts`, which does not import
the exported type.

**Still open — deferred with reason.** `MethodologiesConfig` vs `FrameworksConfig`: both are live
and both are config surfaces (`methodologies?: MethodologiesConfig` at `core-config.ts:427`;
`FrameworksConfig` drives the hot-reload callbacks in `application.ts`). They overlap on
`dynamicToolDescriptions`. That looks like a genuine duplicated config surface rather than a naming
drift, so it needs a wiring audit against `config.json` before either is touched. Not guessed at.

> **Stage 1 finding worth keeping**: `validate:methodologies` caught the rename desynchronising the
> Zod field names from the on-disk YAML (`methodologyBasis` vs `frameworkBasis`, 9 fields across 19
> files). Typecheck could not see it — the schema and the data are only bound at runtime. Any future
> stage that renames a schema field must re-run `validate:methodologies`, not just `tsc`.
>
> **Stage 3 outcome**: no `MCP_WORKSPACE` overlay existed at rename time (checked before moving), so
> nothing was orphaned. Verified behaviourally — `validate:methodologies` resolves all 8 definitions
> from `resources/frameworks/`. A missed path constant would have produced an empty registry at
> runtime while still passing `tsc`.
>
> **Stale version history needs no cleanup code.** `version_history` lives in `state.db`, and
> `dropAllTables()` on the `SCHEMA_VERSION` 15 → 16 bump already recreates the whole database on
> next start. A second clearing mechanism would duplicate one that already fires.
>
> **Three things still carry the old word on purpose**, deferred to Stage 4 or beyond: the
> deprecated `methodology:` YAML field inside a framework definition (file format, not resource
> type); the gate-source tag `'methodology'` in the gate accumulator (provenance, not resource
> type); and `Config.methodologies` / `MethodologiesConfig`, which duplicates `FrameworksConfig` and
> needs a wiring audit against `config.json` first.

> **3.7 trap**: `811` is a whole-repo count of a common English word. Scope strictly to the
> automation domain that owns the rename, or the sweep corrupts unrelated code.
> **3.9 constraint**: must not cross `no-frameworks-in-gates` (`.dependency-cruiser.cjs:148`).

### Tier 4: Compat-site classification. REPORT ONLY.

| ID  | Status | Step                                                                                                                        | Files                                                                             | Depends | Verification                                                                                        |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| 4.1 | ✓      | **NEW** audit — row per ~40 site: `file:line`, what it guards, consumer probe, verdict LOAD-BEARING / SPECULATIVE, evidence | `plans/techincal_debt/compat-site-audit.md`                                       | 3.10    | Every `rg -n "backward compat\|Kept for\|for compatibility" src` hit has a row; zero blank verdicts |
| 4.2 | ✓      | Row for the id-vs-`section_header` mismatch found during Phase 2.5                                                          | `resources/methodologies/cageerf/phases.yaml`, `implementation_plan/verification` | 4.1     | Row cites both files and the divergent field names                                                  |
| 4.3 | ✓      | Apply only SPECULATIVE + human-approved verdicts; one commit per site                                                       | (per-site)                                                                        | 4.1     | `test:ci` + exercise the guarded behavior end-to-end                                                |

**Gate**: `npm run typecheck && npm run test:ci && npm run validate:all` + `/verify` per changed behavior

### New file justifications

- **`server/knip.json`** — config must live in a file knip discovers by name; cannot be a function
  in an existing module. Absent under all 3 candidate filenames.
- **6 guard scripts** (~40 lines each, cloning `validate-no-prompt-gates-alias.js`) — a single
  combined guard was **rejected**: one failure would mask the others and the diff would not
  identify which retirement regressed. One-file-per-retirement is the established in-repo pattern.
- **`compat-site-audit.md`** — work product, not code. Separate from the existing plan file
  because that file is being corrected in 0.4 and must not simultaneously grow.

---

## Phase 4-6 — Validation & Completion

### Testing strategy

| What to test                                           | Test type               | Location                                                  | Why this type                                                                                                                                    |
| ------------------------------------------------------ | ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| YAML-driven gate selection (the 9 migrated assertions) | Integration             | `tests/integration/gates/gate-category-selection.test.ts` | Exercises real YAML loading + resolver; a unit test with mocks would not prove the behavior survived relocation                                  |
| Each guard script fires correctly                      | Manual + CI             | `scripts/validate-no-*.js`                                | Verify by deliberately reintroducing the retired identifier and confirming exit 1 — a guard never exercised in its failing direction is unproven |
| Post-rename runtime behavior                           | Integration + `/verify` | `tests/integration/**`                                    | Renames touch string literals in logs/errors that typecheck cannot see                                                                           |
| Chain execution parity, STDIO + SSE                    | Integration             | `npm run test:integration`                                | Transport parity is a project constraint                                                                                                         |
| Barrel removal                                         | Static                  | `npm run validate:arch`                                   | dependency-cruiser is the only thing that sees boundary violations                                                                               |
| Compat-site removals (4.3)                             | Integration, per-site   | varies                                                    | Each fallback guarded a specific edge case; that case must be driven explicitly                                                                  |

### Done criteria

| Criterion               | Validation                              | Pass condition                      |
| ----------------------- | --------------------------------------- | ----------------------------------- |
| Gate index fresh        | `npm run validate:gate-index`           | exit 0 (today: "✗ stale")           |
| Dead method gone        | `rg "\bgetCategoryGates\b" src`         | 0 hits, 9 assertions still pass     |
| Guards live             | `npm run validate:all`                  | 20 members, exit 0                  |
| Guards actually guard   | Reintroduce each retired identifier     | every guard exits 1                 |
| Vocabulary unified      | `rg -c "<term>" src tests hooks docs`   | 0 per retired vocabulary            |
| Dead files reduced      | `npx knip`                              | unused-file count < 57 baseline     |
| No regressions          | `typecheck && test:ci && validate:arch` | green at every tier boundary        |
| Ratchet locked          | `lint:ratchet:baseline`                 | re-run at every tier gate           |
| Compat sites classified | `compat-site-audit.md`                  | every site has a verdict + evidence |

### Documentation

| Doc                                               | Update needed                                                                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md` Domain Ownership Matrix               | **Yes if 0.5 approves renames** — `:57`, `:65`, `:66` name `GateManager`/`FrameworkManager`. Must change in the SAME commit as 3.9 |
| `CHANGELOG.md`                                    | Yes — Removed + Fixed entries below                                                                                                |
| `docs/guides/gates.md`                            | Check for `getCategoryGates` / category-gate references                                                                            |
| `docs/architecture/overview.md`                   | Check for retired vocabulary                                                                                                       |
| `plans/techincal_debt/arg-gate-pipeline-fixes.md` | Yes — step 0.4                                                                                                                     |
| `hooks/**` (Python)                               | Yes — outside tsconfig; renames invisible to typecheck                                                                             |

### Risks

| Risk                                         | Impact                                                      | Mitigation                                                                     | Rollback                                  |
| -------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------- |
| Rename breaks string literals in logs/errors | High — silent runtime degradation, typecheck green          | `rg` the retired term across `src tests hooks docs`, never typecheck alone     | `git revert` the single-vocabulary commit |
| Test files excluded from tsconfig desync     | High — Jest fails after "clean" typecheck                   | `test:ci` after every sub-step, not just tier end                              | Per-step revert                           |
| Python hooks desync                          | Medium — hook layer reads DB/vocabulary independently       | Include `hooks/` in every rename `rg` sweep; `validate:python` in validate:all | Per-step revert                           |
| CLAUDE.md desync from renames                | Medium — handbook contradicts code                          | 0.5 ruling first; CLAUDE.md edited in the same commit as 3.9                   | Per-module revert                         |
| `mode` → `trigger` over-reaches              | High — `mode` is a common English word, 811 whole-repo hits | Scope to `src/modules/automation/**` only                                      | Revert 3.7                                |
| Blind knip deletion removes live code        | High                                                        | 0.3 config + 2.1 per-entry classification                                      | Restore file, re-run typecheck            |
| Deleting a load-bearing fallback             | High — converts latent bug to live bug                      | Tier 4 report-only; default LOAD-BEARING when unclassifiable                   | Per-site revert (one commit each)         |
| Ratchet slackens silently                    | Medium — re-admits violations equal to what was removed     | `lint:ratchet:baseline` at every tier gate                                     | Restore prior baseline JSON               |
| MCP server serves stale `dist/`              | Medium — live tests show old behavior                       | Rebuild + restart server after each tier                                       | n/a                                       |

### Release

```
commit_convention : chore(<scope>): <description>
scopes            : gates, chains, frameworks, execution, scripts, config, docs, tests
examples          : chore(scripts): wire orphaned validate-no-* guards into validate:all
                    refactor(gates): delete dead getCategoryGates after migrating assertions
                    refactor(chains): unify ChainSessionManager vocabulary to ChainSessionStore
                    fix(gates): regenerate stale gate index
```

**Changelog**

- **Removed** — Dead compatibility scaffolding across the server: deprecated aliases with no
  consumers (`ChainSessionManagerOptions`, `createChainSessionManager`, `ExecutionMode`,
  `ExecutionModeSchema`, `GateManager.getCategoryGates`, delegation terminology helpers), one-off
  migration scripts, and cross-layer re-export barrels. Unified duplicated vocabulary to one name
  per concept. Each retirement is locked by a `validate-no-*` guard wired into `validate:all`.
- **Fixed** — Regenerated the stale gate index so `validate:gate-index` passes with
  `creed-fidelity` and `math-fidelity` indexed; wired three previously orphaned `validate-no-*`
  guard scripts into the validation suite.

### Growth capture

- [ ] **Pattern**: "Orphaned enforcement" — a project inventing a guard mechanism and never wiring
      it. Found 3× here (guard scripts, identity no-op renames, stale plan status column).
      Candidate for `/knowledge-capture` after a second independent occurrence.
- [ ] **Correction (log now)**: `rg -c` counts _matching lines_, not occurrences or assertions.
      Reporting it as "12 assertions" was wrong; actual was 9. Any count feeding a plan must come
      from a probe measuring the thing claimed. → `~/.claude/observations.jsonl`
- [ ] **Memory**: knip is installed but unconfigured in this repo — its raw output is not a work list.
- [ ] **Skill**: `/refactoring` pre-flight could add an explicit "is the inventory reconciled?" check
      before consuming any generated list. Defer to second occurrence.

---

## Delegation boundary

| Agents MAY                                      | Agents MAY NOT                            |
| ----------------------------------------------- | ----------------------------------------- |
| Execute Tiers 1-3 against a reconciled list     | Perform 0.5 (naming ruling)               |
| Produce the Tier 4 evidence table               | Classify 2.1 barrel entries               |
| Run probes, report counts with the command used | Apply any Tier 4 verdict                  |
| Draft guard scripts from the existing shape     | Delete anything from an unreconciled list |

The failure being corrected is trusting an unreconciled artifact — so the reconciliation itself
never delegates.

---

### Tier 5: Contract-surface vocabulary + the guard. Gated on the pass 1-5 renames being committed.

Passes 1-5 finished the **vocabulary** rename (1616 → 418 repo-wide). What remains is not
vocabulary: every hit is a wire token, config key, or authoring-payload field, and each needs a
coordinated change across `Contract → Generated → Types → Router → Manager → Service` with a
back-compat fold. `.claude/rules/mcp-contracts.md` governs; **verify upstream before editing any
contract**, which is the rule that already caught the `version`/`from_version` mismatch.

Two precedents to copy rather than reinvent: `FrameworkSchema` folds `methodologyGates` →
`frameworkGates`, and `GatePassCriteriaSchema` folds `methodology` → `framework`. Both are
`.passthrough()` schemas where a dropped key fails **silently** — that class already shipped once
as regression #3 and again as the near-miss in pass 5, so **every rename below ships with a fold
and a negative-verified test**, not one or the other.

| ID  | Status | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Depends | Verification                                                                                                                                               |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.0 | ✓      | **Re-measure. Do not trust the 418.** Recount per token repo-wide and reconcile against this table before editing — the pass-5 opening found 1418 where 569 was assumed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | (probe only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | —       | Per-token counts recorded with the command used; any row here that disagrees is corrected first                                                            |
| 5.1 | ✓      | `{METHODOLOGY}` → `{FRAMEWORK_TYPE}` prompt-template placeholder. Accept **both** spellings on read; `{FRAMEWORK_NAME}` already exists beside it and holds `framework.name`, so the new name must say _type_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `src/engine/frameworks/prompt-guidance/service.ts` (~288, ~303)                                                                                                                                                                                                                                                                                                                                                                                                                                   | 5.0     | Both spellings substitute correctly; `variablesUsed` lists the new name; test asserts a template using the old spelling still renders                      |
| 5.2 | ✓      | `gates.methodologyGates` config key → `gates.frameworkGates`, folding the old key forward. **25 sites across 15 files** (corrected by 5.0; the type declaration was missing from the original list)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `src/shared/types/core-config.ts` **(type decl — do first)**, `src/cli-shared/config-input-validator.ts`, `src/cli-shared/config-operations.ts`, `src/mcp/tools/config-utils.ts`, `src/infra/config/index.ts`, `src/engine/frameworks/definitions/framework-schema.ts`, `src/engine/gates/core/gate-schema.ts`, `config.json`, `config.schema.json`, `resources/schemas/methodology.schema.json`, 2 tests, 2 docs                                                                                 | 5.0     | Extend `tests/unit/infra/config/legacy-key-migration.test.ts`; a config.json with the old key still disables framework gates. **Negative-verify the fold** |
| 5.3 | ✓      | `methodology_gates` / `methodology_elements` authoring-payload keys → `framework_gates` / `framework_elements`, accepting both on read. Touches the Python validator that scores drafts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **contract layer, added by 5.0**: `tooling/contracts/resource-manager.json`, `_generated/resource_manager.generated.ts`, `resource-manager/core/{router,types}.ts`, `framework-manager/core/types.ts`, `framework-draft-validator.ts` — plus `resources/prompts/examples/create_framework/**` (prompt.yaml, user-message.md, `tools/framework_builder/{schema.json,script.py,description.md}`), `framework-file-writer.ts`, `framework-lifecycle-processor.ts`, and 39 assertions in 2 test files | 5.0     | `cpm`/`resource_manager` create with **each** spelling produces an identical `framework.yaml`; completeness score unchanged for both                       |
| 5.4 | ✓      | **Reclassified by 5.0 — delete a dead read, not a rename.** `methodology_id` is declared in no contract and no schema; `z.object()` strips it at the MCP boundary, so `args.methodology_id` is always `undefined` and `\|\| args.framework` has been doing the work. Remove the read and the `methodology_id` mentions in user-facing help text                                                                                                                                                                                                                                                                                                                                                                                       | `system-control/handlers/framework-action-handler.ts` (only)                                                                                                                                                                                                                                                                                                                                                                                                                                      | 5.0     | `inspect` still resolves via `framework`; help text names only parameters the schema declares                                                              |
| 5.5 | ✓      | `inspect_methodology` MCP response label → `inspect_framework`. Response-only, no input parsing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `system-control/handlers/framework-action-handler.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                             | 5.4     | Response label asserted in an integration test                                                                                                             |
| 5.6 | ✓      | `methodology_compliance` gate `pass_criteria` value → `framework_compliance`, accepting both. **Premise corrected by 5.0**: nothing branches on the literal, stage 09b triggers on `phases.yaml` guards instead, and it is a closed `z.enum` — so a stale value fails **loudly**, not silently. Fold anyway so workspace gates keep parsing                                                                                                                                                                                                                                                                                                                                                                                           | `src/engine/gates/core/gate-schema.ts`, `gate-primitives.ts`, `resources/prompts/examples/create_gate/**`, `docs/guides/gates.md`, `resources/gates/_index.md`, `scripts/generate-gate-index.js` (`phase-guards.md` has zero hits — stale entry)                                                                                                                                                                                                                                                  | 5.0     | A gate authored with each spelling parses to the same criteria type; **negative-verify** by removing the fold and watching the old-spelling test fail      |
| 5.7 | ⊘      | **DEFERRED — retirement condition measured false (2026-07-30).** `git grep -l 'methodologyGates' v2.1.0 -- server/resources/methodologies` returns 7 shipped framework files, so a v2.1.0 workspace copy still depends on the folds; retiring now would silently drop those gate arrays. **Fires when**: the first major release after the rename ships. Then delete the folds, their tests, and their `validate-no-methodology-vocab` allowlist entries in one commit. Original step: retire the two folds added in pass 5 (`FrameworkSchema.methodologyGates`, `GatePassCriteriaSchema.methodology`) **only** once no shipped or workspace resource uses the old spelling. A fold with no retirement condition is a parallel system | `framework-schema.ts`, `gate-schema.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 5.2-5.6 | `rg` across `resources/` returns zero old spellings; folds and their tests deleted together                                                                |
| 5.8 | ✓      | **Write the guard — allowlist, not zero.** `scripts/validate-no-methodology-vocab.js` fails on any `methodolog*` outside an explicit token allowlist; register in `validate:all` (18th member)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `server/scripts/validate-no-methodology-vocab.js`, `server/package.json`                                                                                                                                                                                                                                                                                                                                                                                                                          | 5.1-5.7 | Passes on a clean tree; **fails** when a `methodology` identifier is reintroduced; allowlist entries each carry a retirement condition                     |

**Gate**: `npm run validate:all` green with the new guard registered; every fold has a
negative-verified test; `resource_manager` create/update accepts both spellings for every renamed
key; integration failure set compared with vocabulary normalised on both sides (a naive diff
reports fake regressions when test descriptions rename).

**Explicitly NOT in this tier**: `plans/` and `CHANGELOG.md` (the archived record),
`scripts/rename-symbols.ts` (historical record of past renames), and the internal-only
`'methodology'` literals that remain in test fixture data.

#### 5.0 outcome — re-measurement (2026-07-30)

Commands used (`SCOPE` = tracked files minus `plans/`, `CHANGELOG.md`, `rename-symbols.ts`,
`cli/dist/`):

```bash
git ls-files -z | xargs -0 rg -c -i 'methodolog'                 # 457 hits / 82 files (tracked)
SCOPE | xargs -0 rg -c -i 'methodolog'                           # 258 hits / 70 files (in scope)
SCOPE | xargs -0 rg -c '<token>'                                 # per row, below
```

| Token                             | Plan assumed                | Measured                       | Verdict                               |
| --------------------------------- | --------------------------- | ------------------------------ | ------------------------------------- |
| repo-wide `methodolog*`           | 418                         | **457** tracked / 258 in scope | Drifted — plan text itself added hits |
| `{METHODOLOGY}`                   | 2 sites, 1 file             | **2 sites, 1 file**            | Confirmed                             |
| `methodologyGates`                | "6 sites, 4 files"          | **25 sites, 15 files**         | **Undercounted 4x**                   |
| `methodology_gates` / `_elements` | ~6 files                    | **70 + 30 across 15 files**    | **Undercounted**                      |
| `methodology_id`                  | contract + schema + handler | **handler only (5)**           | **Row premise wrong**                 |
| `inspect_methodology`             | handler                     | **handler only (3)**           | Confirmed                             |
| `methodology_compliance`          | 5 files                     | **20 across 9 files**          | Undercounted; premise wrong           |

**Four rows had a false premise, not just a bad count:**

- **5.2** omitted `src/shared/types/core-config.ts` from its Files column — the _type declaration_
  for the key. Renaming the four call sites without it produces a silent type/runtime split, which
  is the same shape as regression #3. Also missing: `config.json` (the live config), the existing
  `framework-schema.ts` fold, and 2 tests.
- **5.3** omitted the entire contract layer it claims to be about — `tooling/contracts/resource-manager.json`,
  `_generated/resource_manager.generated.ts`, `resource-manager/core/router.ts`, and
  `resource-manager/core/types.ts` — plus 39 test assertions. `.claude/rules/mcp-contracts.md`
  names verifying upstream first as the rule; the row skipped its own rule.
- **5.4 is not a rename.** `methodology_id` is declared in neither `tooling/contracts/system-control.json`
  nor `system-control.schema.ts`. The schema is a plain `z.object()`, and Zod 3.25.76 strips unknown
  keys (verified by direct parse: `{framework, methodology_id}` → `['framework']`). The MCP SDK
  normalises and parses with that object, so `args.methodology_id` is **unreachable** — always
  `undefined`, with `|| args.framework` silently covering for it. Reclassified: **delete the dead
  read**, do not add an alias for a param no client can send.
- **5.6's enforcement claim is wrong in both halves.** Nothing branches on the literal
  `'methodology_compliance'` — it appears only as a `z.enum` member, a TS union member, and doc
  comments. Stage 09b triggers on _active framework + `phases.yaml` guards_
  (`getPhasesWithGuards(frameworkId)`), never on the criteria type. And because it is a **closed
  enum, not `.passthrough()`**, a stale value fails **loudly** at parse rather than dropping
  silently. No shipped `gate.yaml` uses it (measured: `inline_guidance` 47, `validation` 21,
  `category` 4, `shell_verify` 1, `framework` 1, `custom` 1). The fold is still worth having so
  workspace-authored gates keep parsing, but this row is not the tier's risk centre.

`docs/guides/phase-guards.md` is listed under 5.6 but contains zero hits — stale Files entry.

> **Fourth falsified count in this plan.** My own first probe also lied: `rg -F '{METHODOLOGY}'`
> returned zero because the source holds the _regex_ form `\{METHODOLOGY\}`. A fixed-string search
> for a token that lives inside a regex literal is not the same search. Confirmed by reading the
> file.

#### Tier 5 outcome (2026-07-30)

Eight of nine rows landed. **5.7 stays open — its retirement condition is provably false.**

**5.7 blocked, with evidence.** `git grep -l 'methodologyGates' v2.1.0 -- server/resources/methodologies`
returns **7 shipped framework files**. Any user who installed v2.1.0 and copied one into a
workspace still depends on the folds. Retiring now would silently drop their gate arrays — the
exact failure the folds exist to prevent. **Retirement condition, stated so it can be checked:**
the first major release after the rename ships, at which point v2.1.0 workspaces are out of
support. Delete the folds, their tests, and their `validate-no-methodology-vocab` allowlist
entries in one commit.

**Three live defects found while renaming** (none is a rename; all were found _by_ one):

| #   | Defect                                                                                                                                                                                                                                                                                                                            | Found by                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| D7  | `persistFrameworkConfig` wrote `frameworks.injection.systemPrompt.enabled` and `gates.enableMethodologyGates` — **neither is in `CONFIG_VALID_KEYS`**. `updateConfigValue` rejects unknown keys and the loop returns on first failure, so `system_control` framework enable/disable with `persist:true` wrote **nothing at all**. | 5.2 allowlist probe         |
| D8  | `generateSystemPrompt` in `framework-manager.ts` substituted only 3 of the 5 template placeholders, so a template using `{FRAMEWORK_TYPE}` or `{PROMPT_TYPE}` rendered literal braces through that path while rendering correctly through `PromptGuidanceService`. Both now share the extracted `substituteTemplateVariables`.    | 5.1 defined-elsewhere probe |
| D9  | Two `eslint.config.js` restricted-import rules banned `frameworks/methodology/guides/*`, a path deleted in pass 4 — dead rules that banned nothing. Now ban both spellings.                                                                                                                                                       | 5.8 guard first run         |

**Docs corrected, not merely renamed.** `gate-schema.ts`, `gate-primitives.ts`, `docs/guides/gates.md`
and `create_gate/user-message.md` all claimed `methodology_compliance` was **"Hard — enforced by
phase guards (stage 09b)"**. `gate-validator.ts:238` auto-passes it; stage 09b triggers on
`getPhasesWithGuards(frameworkId)` from `phases.yaml`, never on the criteria type. Renaming a false
claim leaves a false claim.

**Also landed under this tier**: `enableMethodologyGates` → `enableFrameworkGates` (the _internal_
field, 20 sites across 10 files, absent from the original 5.2 row); `resources/schemas/methodology.schema.json`
→ `framework.schema.json` with its generator; `substituteTemplateVariables` extracted so the fold
is testable rather than reachable only through a private method.

**Verification.** `validate:all` exit 0 with `validate:no-methodology-vocab` registered as its 18th
member; guard negative-verified (exit 1 on a reintroduced identifier, exit 0 on a clean tree). Four
folds each negative-verified by gutting them and watching the right tests fail: 5.1 (2 of 7), 5.2
(1 of 10), 5.3 (1 of 6), 5.6 (4 of 7). Full suite **31-32 failed / ~2088 passed** vs **32** at HEAD;
failure-name sets compared with vocabulary normalised on both sides — **zero new**. Both sides were
confirmed non-empty first, since a vacuous comparison already invalidated two earlier passes.

> **Correction (made while verifying Tier 3).** The first write-up of this section claimed Tier 5
> _fixed_ `MCP Server Smoke Tests › server registers expected MCP tools via HTTP`. It did not.
> Two runs of the **identical** tree produced 32 failures each but a different set: that smoke test
> and `Gate Shell Verify … exposes response via env var` swap in and out. Both fail in isolation at
> HEAD, so both are order/environment-sensitive, not regressions and not fixes. A single-run
> failure-set diff cannot tell a fix from variance — for these two, only repeated runs can.

`cli/` build fails identically at HEAD (`esbuild` absent from `cli/node_modules`) — a pre-existing
environment gap, not a Tier 5 regression. `server` build succeeds.

---

### Tier 6: Documented-but-nonexistent surface. A class, not an incident.

Three separate instances turned up while finishing the rename, each found only because a rename
walked past it: five dead env vars, five dead CLI flags, and a four-tier path "Resolution Priority"
whose top two tiers do not exist. All were **user-facing**, all had been wrong for a long time, and
none is detectable by `typecheck`, `lint`, or the test suite — the docs and the parser are simply
never compared.

| ID  | Status | Step                                                                                                                                                                                                                                 | Files                                                                  | Depends | Verification                                                                                              |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| 6.0 | ☐      | Enumerate every CLI flag and `MCP_*` env var named anywhere in `docs/`, `README.md`, `server/README.md`, `CONTRIBUTING.md` and the platform manifests; diff against what `src/runtime/{cli,options}.ts` parses and what `src/` reads | (probe only)                                                           | —       | A table of documented-vs-parsed, with every mismatch classified as "remove from docs" or "implement"      |
| 6.1 | ☐      | Apply the 6.0 verdicts. Name each removed option in place rather than deleting silently, so a user who copied it from an older revision can tell what happened                                                                       | per 6.0                                                                | 6.0     | `validate:readme` 0; no doc names an unparsed flag or unread env var                                      |
| 6.2 | ☐      | **Automate it.** A `validate:documented-options` script that extracts flags/env vars from docs and fails when one is not parsed/read. This is the only member of the tier that prevents recurrence                                   | `server/scripts/validate-documented-options.js`, `server/package.json` | 6.1     | Fails when a fake `--nonexistent` is added to a doc; passes on a clean tree; registered in `validate:all` |

**Gate**: `validate:all` green with 6.2 registered; introducing a fabricated flag into any doc
fails CI.

> **Why this deserves a tier rather than a bug entry.** The same defect shape recurred three times
> in one session, and the first fix for it was itself incomplete — the README tables were corrected
> while the config example, the command example and the troubleshooting line still told users to
> use the dead options. Fixing the reference and leaving the instructions is the worse half of the
> job. 6.2 is the part that matters; 6.0/6.1 are one-time cleanup.
