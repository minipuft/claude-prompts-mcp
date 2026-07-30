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

| ID  | Status | Step                                                                                                                                                                                                          | Files                                             | Depends                            | Verification                                                                                                                                                                |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.2 | ✓      | Run `node scripts/generate-gate-index.js` to index `creed-fidelity` + `math-fidelity`. **REORDERED — see Deviation 1**                                                                                        | `server/resources/gates/_index.md`                | —                                  | `npm run validate:gate-index` → "✓ up-to-date"; both gates present at `_index.md:15` and `:64`; 21 gates + 1 config dir = 22 dirs                                           |
| 0.1 | ☐      | Commit `relicense/readme-rework` (now including 0.2); `git checkout -b chore/shim-debt-sweep`                                                                                                                 | (branch)                                          | 0.2                                | `git status` clean; `git branch --show-current` = `chore/shim-debt-sweep`                                                                                                   |
| 0.3 | ✓      | **NEW** knip config. Shipped as ignore-`_generated`-only; **did NOT ignore `scripts/migration/**` — see Deviation 6\*\* (doing so would make 1.3's verification vacuous). Run out of tier order during Tier 2 | `server/knip.json`                                | ~~0.1~~ (none — additive new file) | **DONE** — `npx knip` runs with config; unused files **56** vs unconfigured **57**. Premise largely falsified: the config buys one line, the report was already trustworthy |
| 0.4 | ✓      | Correct stale status column: mark item 2.4 done, cite `gate-set-resolver.ts:273/277/282`                                                                                                                      | `plans/techincal_debt/arg-gate-pipeline-fixes.md` | 0.1                                | `rg -n "2\.4" plans/techincal_debt/arg-gate-pipeline-fixes.md` shows completed marker                                                                                       |
| 0.5 | ✓      | **RULED 2026-07-29 (human)**: renames APPROVED; `CLAUDE.md` Domain Ownership Matrix updates to match in the same commit as 3.9                                                                                | (decision)                                        | 0.1                                | Ruling recorded in this file — see Naming Ruling below                                                                                                                      |
| 0.6 | ✓      | Delete the 4 identity no-op RENAMES entries (`FrameworkStateStore`, `GateStateStore`, `TextReferenceStore`, `ConversationStore` → themselves)                                                                 | `server/scripts/rename-symbols.ts`                | 0.5                                | `rg -n "oldName: '(\w+)', newName: '\1'" server/scripts/rename-symbols.ts` returns 0                                                                                        |

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

| ID   | Status | Step                                                                                                                                                                                                                                                                                                                                                | Files                                                                                        | Depends  | Verification                                                                                                        |
| ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| 3.1  | ✓      | `StepState` → `StepLifecycle` — **DONE 2026-07-30** (deferred, then executed same day on operator request). Not a rename — enum→union+substate-flags data-model migration touching persisted `chain_run_registry` shape. Full context, site inventory and execution order: [`stepstate-lifecycle-migration.md`](./stepstate-lifecycle-migration.md) | `shared/types/`, `modules/chains/manager.ts`, `engine/execution/capture/`, `infra/database/` | 0.5      | **DONE** — typecheck 0, 1696 tests, `validate:all` 0, `validate:arch` 0, `build` 0                                  |
| 3.2  | ✓      | **DONE** — `scripts/validate-no-stepstate.js` added + registered; `validate:all` now **17** members; negative-tested both directions                                                                                                                                                                                                                | `scripts/validate-no-stepstate.js`, `package.json`                                           | 3.1      | **DONE** — `validate:all` 17 members, exits 0                                                                       |
| 3.3  | ✓      | `ChainSessionManager` → `ChainSessionStore` (**177**→0, not 143) incl. lowercase `chainSessionManager`. 33 files + test file renamed `chain-session-manager.test.ts` → `chain-session-store.test.ts`                                                                                                                                                | `src/`, `tests/`, `docs/` (no `hooks/` hits)                                                 | 3.2      | **DONE** — residual 0; typecheck 0, 1696 tests, `validate:all` 0, `validate:arch` 0                                 |
| 3.4  | ✓      | **NEW** guard + registration                                                                                                                                                                                                                                                                                                                        | `scripts/validate-no-chainsessionmanager.js`, `package.json`                                 | 3.3      | **DONE** — `validate:all` **16 members**, exits 0; guard negative-tested (reintroduce → exit 1)                     |
| 3.5  | ☐      | `delegat*` → `handoff*` (336→0)                                                                                                                                                                                                                                                                                                                     | `src/`, `tests/`, `hooks/`, `docs/`                                                          | 3.4      | `rg -ci "delegat" src tests hooks docs` = 0 or survivors justified inline                                           |
| 3.6  | ☐      | **NEW** guard + registration                                                                                                                                                                                                                                                                                                                        | `scripts/validate-no-delegation-vocab.js`, `package.json`                                    | 3.5      | `npm run validate:all` exits 0                                                                                      |
| 3.7  | ☐      | `mode` → `trigger`, **automation scope ONLY**                                                                                                                                                                                                                                                                                                       | `src/modules/automation/**`, `src/shared/types/automation.ts`                                | 3.6      | `rg -c "\bmode\b" src/modules/automation` = 0                                                                       |
| 3.8  | ☐      | **NEW** guard + registration                                                                                                                                                                                                                                                                                                                        | `scripts/validate-no-execution-mode.js`, `package.json`                                      | 3.7      | `npm run validate:all` exits 0                                                                                      |
| 3.9  | ◐      | **DIRECTION REVERSED** by operator 2026-07-30: unify on **`framework`**, not `methodology`. Stage 1 of 4 DONE — 602 replacements / 68 files across the **72 non-colliding** tokens, plus 189 YAML field renames (`methodologyBasis`→`frameworkBasis` etc.) in 19 resource files                                                                     | `src/`, `tests/`, `resources/**/*.yaml`                                                      | 3.8, 0.5 | **STAGE 1 DONE** — typecheck 0, 1696 tests, `validate:all` 0, `validate:arch` 0, `lint:ratchet` 0. Stages 2-4 below |
| 3.10 | ☐      | **NEW** guard + registration                                                                                                                                                                                                                                                                                                                        | `scripts/validate-no-framework-vocab.js`, `package.json`                                     | 3.9      | `npm run validate:all` exits 0                                                                                      |

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
| 4     | `docs/`, `CLAUDE.md`, `>>create_methodology` prompt id, then `scripts/validate-no-methodology-vocab.js` + registration                                                       | ☐                                                                                                                |

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
| 4.3 | ☐      | Apply only SPECULATIVE + human-approved verdicts; one commit per site                                                       | (per-site)                                                                        | 4.1     | `test:ci` + exercise the guarded behavior end-to-end                                                |

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
