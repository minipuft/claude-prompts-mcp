---
title: "Validation Mechanism Architecture — right tool per check class"
date: 2026-08-05
status: active
tags: [tooling, validation, eslint, technical-debt]
---

# Validation Mechanism Architecture

**Area**: `server/scripts/**` (39 files), `server/eslint-rules/`, `server/package.json` `validate:all`
**Work type**: refactor
**Origin**: operator question 2026-08-05 — "should we really be utilizing scripts like this for
enforcing this sort of behavior, or is there a better standard?"
**Confidence**: high on the inventory (every count is a probe result); **medium on the Tier 1 line
savings**, because per-script AST feasibility is triaged but not proven — see the correction below.

**Predecessor**: `validation-surface-cleanup-2026-08-04.md` (Tier F5, complete). That plan asked
_is each check wired and does it retire?_ and settled both — all nine guards now carry a retirement
condition, `verify:mcp` runs in CI, dead aliases are gone. **This plan asks a different question:
is each check in the right mechanism at all?** Do not re-litigate F5's findings here.

---

## The observation

**As authored (2026-08-05):** nine `validate-no-*` guards hand-roll file walking and regex over
source files. ESLint already parses every one of those files, has the AST, gives editor feedback,
supports `--fix`, and feeds a ratchet this repo already trusts. `server/eslint-rules/claude-plugin.js`
**already exports four working custom rules** (`no-context-deep-imports`, `no-legacy-imports`,
`require-file-lifecycle`, `no-emojis`) and is wired at `eslint.config.js:12` (**not** `.mjs` — that
file never existed). The better standard is not hypothetical here — it is already half-adopted, and
the guards are the half that did not move.

**As measured (2026-08-06, after 1.1 / 1.2 / 0.3 / 0.5 / 1.4 / 1.5):** **five** guards, **seven**
custom rules, four `no-restricted-syntax` selectors, plus one dependency-cruiser rule that absorbed
a guard whole. The premise held — but "the half that did not move" was wrong about _why_ they had
not: only two of the seven could have moved to ESLint at all. See the three-property model in the
Iterated approach.

**And one of those two had never worked.** 1.5 found that `no-prompt-gates-alias` reported clean
over a live instance of the defect it names; 1.6 then measured that it had been that way from the
start — the defect predates the guard, and the guard sat unwired for 4.5 months before landing in
`validate:all` already vacuous. That reframes the plan's own premise: the case for re-homing is not
only that ESLint is a better mechanism, but that a hand-rolled regex guard can be **born** unable to
see its target and stay green forever, which is a failure mode neither the ratchet nor CI can see.

## Inventory

**Authored 2026-08-05, corrected the same day during execution.** Every original count was wrong by
the time it was executed — the drift is recorded rather than overwritten, because the _pattern_ of
drift is the reusable finding.

| Fact                             | As authored            | Measured at execution                                                                                             | Probe                                                                                                                                                                              |
| -------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scripts under `server/scripts/`  | 39                     | 40 → 39 (1.1) → 38 (1.2) → 36 (1.4, 1.5) → **37 files + 1 dir** (3.1, 4.1)                                        | ~~`ls scripts/ \| wc -l`~~ — **the probe stopped meaning one thing at 4.1**: it returns 38 by counting `scripts/lib/` as a script. Use `find scripts -maxdepth 1 -type f \| wc -l` |
| `validate:all` chain length      | 49 steps               | 53 → 33 (1.1, 2.1) → 32 (1.2) → **30**                                                                            | ~~`scripts['validate:all'].split(' && ').length`~~ — **probe retired 3.1**: `validate:all` is no longer a shell chain. Use `run-validation-suite.js` `SUITE.length`                |
| `:self-test` steps               | 17                     | **19**, now **0** in the chain                                                                                    | same parse — likewise re-pointed at `SUITE`                                                                                                                                        |
| `validate:all` wall time         | 38.7 s over 33 steps   | **47.6 s over 30 steps** (`&&`) · 46.5 s (runner) — fewer steps, longer run; the 38.7 s figure does not reproduce | `time npm run validate:all`, 3.1                                                                                                                                                   |
| custom ESLint rules              | 4                      | **7** after 1.1, 0.3 and 1.4                                                                                      |
| `no-restricted-syntax` selectors | not counted            | 2 → **4** (1.5 added two, in the same array)                                                                      | `eslint.config.js` `no-restricted-syntax[]`                                                                                                                                        |
| dependency-cruiser rules         | not counted            | **+1** — absorbed a guard whole in 1.2                                                                            | `.dependency-cruiser.cjs` `forbidden[]`                                                                                                                                            |
| `validate-no-*` guards           | 8                      | 8, a _different_ eight (F3) → 7 (1.2) → **5**                                                                     | `wc -l scripts/validate-no-*.js`                                                                                                                                                   |
| plugin wiring                    | `eslint.config.mjs:12` | **`eslint.config.js:12`** — file never existed                                                                    | `rg -n claude-plugin eslint.config.*`                                                                                                                                              |
| candidate guards "source-only"   | 4 of 8                 | **2 of 8** genuinely portable                                                                                     | scan scope, not artifact reads — see F1                                                                                                                                            |

### F1 — the classification probe measured the wrong property

The original probe was `rg -q 'existsSync|readdirSync.*resources|\.yaml|\.json'` per file: a test for
**artifact reads**. Portability is decided by **scan scope**, which was never probed. `no-stepstate`
reads no artifacts and so classified as portable, while it scans a directory ESLint cannot see.

### F2 — grep the behavior, not a token that appears inside it

A probe for `import.meta.url` reported 13 of 19 self-test scripts as entry-guarded. False positive:
those files use `fileURLToPath(import.meta.url)` for path resolution. Probing the real idiom
(`import.meta.url ===` / `require.main ===`) gives **1 of 19**. Two probes, opposite answers, same
file set.

**Both F1 and F2 are the same error**: probing a token that co-occurs with the property instead of
the property. Any future inventory in this plan states which property it measures.

### F3 — a stable count can hide a changed set

"Eight guards" was true when authored and is still true today, and the set is not the same one.
1.1 deleted `no-crosslayer-reexport`; `d219f8b7` added `no-llm-client`. Measured 2026-08-06:
`no-crosslayer-relative` (167), `no-execution-mode` (98), `no-legacy-sidecars` (50),
`no-llm-client` (283), `no-methodology-vocab` (158), `no-prompt-gates-alias` (51), `no-stepstate`
(64), `no-tool-layer-validator-imports` (83) — 954 lines.

_Re-measured at 1.4/1.5: **102** and **55**, not 98 and 51. The drift is self-inflicted — 1.2 added
a four-line `MECHANISM:` header to each guard it kept or deferred. Worth recording because it is the
cheapest possible instance of the same lesson: a plan's counts decay even when nothing external
moves, and here the plan's own prior tier was the mutator._

A count that survives a substitution is a weaker check than it looks; 1.2's triage covers this list,
not the authored one.

### Correction to the originating claim

> **SUPERSEDED by F1 below and again by 1.2's execution.** Its "realistic Tier 1 scope" listed
> `no-tool-layer-validator-imports` as an ESLint port; 1.2 retired it into dependency-cruiser
> instead, so the destination was wrong as well as the count. This correction fixed the line-count claim but kept the wrong
> portability probe, so its "four that are source-only" is also wrong — the measured figure is two.
> Retained because the reasoning error is the lesson: a correction that does not re-examine the
> _probe_ only relocates the error.

The question was raised with an estimate of "~770 lines of guards move to ESLint." **That is
wrong.** Triage shows four of the eight also read YAML/JSON/filesystem artifacts
(`no-legacy-sidecars`, `no-execution-mode`, `no-methodology-vocab`, `no-crosslayer-relative`) and
therefore cannot move wholesale — ESLint is single-file, source-only. Realistic Tier 1 scope is the
four that are source-only: `no-stepstate`, `no-prompt-gates-alias`, `no-crosslayer-reexport`,
`no-tool-layer-validator-imports` (~298 lines). The other four may still split — an AST half and an
artifact half — but that is a per-script judgment, not a sweep.

## Classification

Checks are not one kind of thing. Three classes, three correct homes.

| Class                  | What it does                     | Correct home       | Examples                                                                                                                                                                  |
| ---------------------- | -------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — source pattern** | bans a construct in TS source    | **ESLint rule**    | `no-crosslayer-reexport` (moved, 1.1). ~~`no-stepstate`~~ — **falsified**: it is a source pattern and still cannot move, because it scans `tests/`                        |
| **B — cross-artifact** | compares two artifacts           | **stays a script** | `validate-table-contracts` (TS module vs embedded DDL), `validate-package-entries` (package.json vs filesystem), `verify-mcp-surface` (registered actions vs live server) |
| **C — self-test**      | asserts the checker itself works | **Jest**           | the 19 `:self-test` steps — moved in 2.1                                                                                                                                  |

Class B is the honest defense of scripts: ESLint is scoped to one file and structurally cannot
compare a TypeScript module against a SQL string, or a manifest against a tarball. Those are not
lint problems and should not be forced into a linter.

> **PARTLY SUPERSEDED by the Iterated approach.** The A/B split survives as the **Relation**
> property and is still correct. What this table got wrong is treating class as _sufficient_ to
> decide a home: `no-stepstate` is Class A by this table and provably immovable by **Reach**, and
> `no-tool-layer-validator-imports` is Class A yet belongs in dependency-cruiser by **Resolution**.
> Read the three properties, not this column, when deciding where a check goes.

## Subtiers

**Status legend**: ☐ pending · ✓ done · ⚠ premise falsified by execution, rewrite before running.

Rows 0.1–0.3 were **discovered during execution**, not authored upfront. They are rows rather than
prose because a finding recorded as narrative does not get executed — see the Discovered Blockers
section for why each exists.

| #   | Status | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Depends | Verification                                                                                                                                                                                                                                                                |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | ✓      | **BLOCKER (blocks 1.1-as-authored, 1.2).** `eslint.config.js` declares a `tests/**` config block at :209 that a global `ignores` at :425 overrides — dead since `0963d4ac` (2026-01-05). Decide: delete the dead block, or un-ignore and ratchet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | —       | Either the dead block is gone, or `npx eslint tests/…` lints instead of reporting "File ignored"; measured cost of un-ignoring: **1,514 errors + 1,470 warnings across 213 files**                                                                                          |
| 0.2 | ✓      | **BLOCKER (blocks the Gate, and 3.1).** `plans/sqlite-layer-remediation-2026-08-03.md` fails `prettier --check` at its committed state and `--write` does not converge — ran 3×, failed each time. `validate:all` cannot pass on this branch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —       | `npm run validate:format` green — via `.prettierignore` with a stated reason, or a content fix that converges                                                                                                                                                               |
| 0.3 | ✓      | Guards are still being **added** as scripts while this plan is open. `validate-no-llm-client.js` (283 ln) landed in `d219f8b7` mid-plan — **2.8×** Tier 1.1's retargeted target, not the authored 4.4× (that ratio was against `no-stepstate`, 64 ln, which 1.1 abandoned). Decide whether new Class-A guards must justify not being ESLint rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | —       | A recorded convention, or a check that flags a new `validate-no-*` script without a stated verdict                                                                                                                                                                          |
| 0.5 | ✓      | **Blind spot in 0.3's satisfied-exception check.** An ESLint rule only visits files that are linted, so an allowlist entry naming a **deleted** guard is never reported. **Premise superseded on execution**: rather than detect the stale entry, 0.5 removed the allowlist — a pending guard now declares `MECHANISM: rehome — <destination> — <row>` in itself, so the marker dies with the `rm` that deletes the guard and the class cannot occur                                                                                                                                                                                                                                                                                                                                                                                                                                          | 0.3     | The rule has no `allowlist` option and `eslint.config.js` carries no per-file exemption for it; all seven guards state an in-file verdict                                                                                                                                   |
| 0.6 | ✓      | ~~**Same blind spot, second instance.** Apply 0.5's in-file form, or fold into 4.1~~ — **both options were wrong**. The row assumed the exemption needed to become _detectable_; measured 2026-08-06 it was already _retirable_: `src/types.ts` had **0 dependents** (dependency-cruiser), **0** resolving import specifiers repo-wide, and `knip` listed it unused. Its stated retirement condition had been met for some time and nothing said so. Deleted the file, the entry, and the rule's `allowlist` option itself                                                                                                                                                                                                                                                                                                                                                                    | 0.5     | ✓ File deleted; entry deleted; option removed from the rule schema; rule re-verified firing on a planted shim and still ignoring a markerless barrel                                                                                                                        |
| 0.7 | ✓      | **`validate-no-methodology-vocab` entry triage.** ~~34 entries~~ — measured **37** (the 34 in this row came from a loose grep in 0.6 that counted comment lines; the coincidence that 34 is also the _surviving_ count is accidental). Probed _does this entry suppress a real hit_: **2 dead, 1 redundant, 34 load-bearing**. Result: **37 → 34**, and the guard still passes with 0 unsuppressed hits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 4.1     | ✓ Every remaining entry suppresses ≥1 hit exclusively; counts recorded before (37) and after (34). Deleting any survivor makes the guard exit 1 (verified on one)                                                                                                           |
| 0.8 | ☐      | **The vocab guard cannot see 57 git-tracked files.** Two causes: ripgrep skips dot-paths without `--hidden`, and `.gitignore` lists `CLAUDE.md` (which is nonetheless tracked). Four unreachable files hold 11 occurrences, and at least two are **stale, not exempt** — `CLAUDE.md` documents a `resource_manager (methodology)` resource type that the schema enum does not contain, and `feature_request.yml` offers "Methodologies" in a user-facing dropdown. Widen the scan, then triage what surfaces. **Second, independent instance measured 2026-08-06 (3.1)**: a consumer search for `validate:tool-schemas` reported "run by nothing" until `--hidden` was added, at which point `.github/workflows/ci.yml` appeared. The defect is not specific to this guard — it is the default of the tool every guard shells out to, and it silently converts "no hits" into "no such thing" | 0.7     | The scan reaches dot-paths and tracked-but-gitignored files; the 11 occurrences are each fixed or allowlisted with a retirement condition                                                                                                                                   |
| 0.9 | ☐      | **Delete the dead dependency-cruiser rule `methodology-via-loader-only`.** Its `to.path` is `methodologies/` (no such directory anywhere), and both `pathNot` exemptions name files under `src/engine/frameworks/methodology/`, which does not exist. The rule is structurally incapable of firing and depcruise reports nothing about it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —       | The rule is gone; `validate:arch` still reports its existing 3 warnings and 444 modules, proving the deletion removed nothing live                                                                                                                                          |
| 0.4 | ✓      | **Findings did not flow back into plans.** `tier_execute` Phase 6 said "Preserve plan file structure entirely — only Status column changes", so every drift correction, falsified premise and discovered blocker died in the transcript. Phase 6 rewritten to Plan Realignment 2026-08-05. `strategicImplement` still has no writeback phase — see 0.5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | —       | A tier execution that falsifies a plan assertion leaves the plan corrected, not just the chat                                                                                                                                                                               |
| 1.1 | ✓      | Prove the pattern on ONE guard. **Retargeted** to `no-crosslayer-reexport` (100 ln) — `no-stepstate` scans `tests/`, which ESLint ignores; see Execution record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | —       | Rule fires on a planted shim; old script flags the same file; script deleted; `validate:all` 53 → 52                                                                                                                                                                        |
| 1.2 | ✓      | **Triage all eight guards: retire / re-home / keep — in that order.** Verdicts issued 2026-08-06: **1 retire** (`no-tool-layer-validator-imports` → `.dependency-cruiser.cjs`, deleted), **5 keep** (`no-stepstate`, `no-legacy-sidecars`, `no-llm-client`, `no-methodology-vocab` on reach; `no-crosslayer-relative` on resolution), **2 re-home** (rows 1.4, 1.5). Every keep verdict is recorded as a `MECHANISM:` marker, not as prose here                                                                                                                                                                                                                                                                                                                                                                                                                                               | 1.1     | A verdict per guard naming retire/re-home/keep with its reason; any guard whose retirement condition is already satisfiable is deleted, not moved                                                                                                                           |
| 1.4 | ✓      | **Re-home `no-execution-mode` (~~98~~ 102 ln) into the ESLint plugin.** Done 2026-08-06 as `claude/no-deprecated-automation-mode`. ~~The port's real cost is its **seven allowlist entries**, which become rule options~~ — **falsified twice over**: there are **10** entries, not seven, and the port needed **none of them** as rule options. An AST rule cannot match prose, and prose is what most of the allowlist existed to suppress; the deprecation fold survives as two `ignores` paths in `eslint.config.js`                                                                                                                                                                                                                                                                                                                                                                      | 1.2     | ✓ Guard deleted; rule observed firing on planted key/dot/bracket/computed/TS-member forms; fold files confirmed silent; automation scope clean                                                                                                                              |
| 1.5 | ✓      | **Re-home `no-prompt-gates-alias` (~~51~~ 55 ln) into `no-restricted-syntax`.** Done 2026-08-06. "Config-only and adds no rule code" held — but **not** for the stated reason, and the guard being ported was **vacuous**: the defect it forbids was **already live in its own target file when the guard was written** (corrected by 1.6 — the record first said it returned a week later), and the guard was not wired into `validate:all` until 2026-07-29, by which point the code read `??` where its regexes required `\|\|`. Ported as a shape selector, which sees it; the live instance carries a sited exemption owned by row 1.6                                                                                                                                                                                                                                                   | 1.2     | ✓ Guard deleted; both old-guard shapes reported on plants; the `&&` form correctly ignored; the real line reported before being explicitly exempted                                                                                                                         |
| 1.6 | ✓      | **Decide whether the prompt-path `args.gates` alias is intended.** Decided 2026-08-06: **unintended**, removed. Deciding evidence was an asymmetry the row did not anticipate — `gates` was accepted on `update` but silently ignored on `create`, which is not a designed alias. Also undocumented for prompt actions, untested, and declared `[Framework]` in the contract while `gate_configuration` is `[Prompt]`. The special case was deleted and `gate_configuration` moved into `UPDATE_FIELDS` like every other field                                                                                                                                                                                                                                                                                                                                                                | 1.5     | ✓ The two `no-restricted-syntax` selectors are retained and now pass with **no suppression**; the `eslint-disable` is gone. Two tests added (field still updates / alias no longer accepted), each reddened by its own mutation                                             |
| 1.3 | ✓      | Per-script judgment on the four mixed guards — split AST half from artifact half, or leave whole. **Decide, do not sweep**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 1.2     | A written verdict per script naming why it moved or stayed                                                                                                                                                                                                                  |
| 2.1 | ✓      | Move the **19** (not 17) `:self-test` entries into Jest                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —       | `validate:all` step count drops by 19 (52 → 33); the same assertions run under `npm test`                                                                                                                                                                                   |
| 3.1 | ✓      | **Replaced the `&&` chain with `scripts/run-validation-suite.js`.** Done 2026-08-06. The suite is now declared as data (`SUITE`, 30 entries, each carrying a measured `io` classification), `validate:all` is `node scripts/run-validation-suite.js`, and the runner runs every step, times it, and re-prints every failure in one recap. Verification exceeded the row: **4** real checks were broken at once and all 4 reported; the same two plants through the old chain reported **1** and hid 3                                                                                                                                                                                                                                                                                                                                                                                         | 2.1     | ✓ Live: two planted files broke 4 checks; runner reported all 4 in one run and re-printed each. Counterfactual measured on the committed `&&` chain — aborted at step 1, **0** mentions of either planted defect. 5 Jest tests, each reddened by its own mutation           |
| 3.2 | ☐      | **`validate:renovate-extraction` is defined and run by nothing.** Not in the suite, not in CI, not in either hook — only its `:self-test` runs (via Jest, since 2.1). The checker's proof-that-it-can-fail passes on every run while the check itself never executes against real inputs. Same shape as 1.5's vacuous guard, reached by a different route: unwired rather than pattern-drifted. Wire it or delete it                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 3.1     | Either the check is a `SUITE` member and passes, or the script and its `:self-test` are both gone                                                                                                                                                                           |
| 3.3 | ☐      | **Nothing asserts that a `validate:*`/`verify:*` script is either in the suite or knowingly excluded.** 50 such scripts exist; 30 are in `SUITE`, 17 are `:self-test` (owned by Jest), leaving 5 outside: `verify:mcp`, `validate:tool-schemas`, `verify:package-artifact` and `validate:build` need a build so cannot sit in a pre-build suite, and `validate:renovate-extraction` (3.2) has no reason at all. 0.3 governs which _mechanism_ a new check uses; nothing governs whether it is ever _run_. 3.1 added a test that every declared step exists — the converse is unguarded                                                                                                                                                                                                                                                                                                        | 3.2     | A check that lists every `validate:*`/`verify:*` script not in `SUITE` and fails unless it carries a stated reason — with the reason retirable, per 4.1                                                                                                                     |
| 4.1 | ✓      | **Shared exception-hygiene harness landed 2026-08-06** as `scripts/lib/exception-hygiene.js` — one definition, five verdicts, consumed by all five Class-B surfaces. **Scope was wrong in both directions.** Authored: 3 surfaces, 46 entries, 38 owed. Measured: **5 surfaces, 51 entries** — the row never counted `table-contracts.ts` `acceptedPhantomColumns` (**3**) or `acceptedForeignWriters` (**2**), which is the surface `.claude/rules/sqlite-persistence.md` names as the canonical instance of this exact blind spot. And **2 surfaces already self-detected, not 1**: `validate-no-llm-client.js` had grown its own `staleAllowlistEntries()` independently. Both are now predicates supplying the shared definition rather than three private ideas of "still true"                                                                                                          | —       | ✓ All five gates observed FAILING on a planted satisfied exception; the vocab guard on all four non-passing verdicts including **unreachable**, which reproduces 0.7's `CLAUDE.md` case mechanically and tells the reader NOT to delete. 10 Jest tests on the shared module |
| 4.2 | ☐      | **The vocab allowlist's 35 entries carry no structural `closedBy`.** Their retirement conditions are grouped prose comments above blocks of entries, so the harness's form check is switched off for that one gate — the only gate where it is. The truth check runs; the form check cannot. Give each entry a `closedBy` field, or accept that this gate's exemptions can never be checked for having an exit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 4.1     | `auditExceptions` is called with a `closedBy` accessor for `no-methodology-vocab`, and an entry with an empty one is reported                                                                                                                                               |
| 4.3 | ☐      | **Form and truth are separate checks and no gate had both.** `validate-table-contracts` checked `closedBy` non-empty and never whether the exception was still needed; `no-llm-client` checked the reverse. 4.1 gave every gate both, but nothing states the pair as a requirement for a _new_ exception surface — the same inflow gap 0.3 closed for guard mechanism and 3.3 opens for suite membership                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 4.1     | A stated convention, or a check that a newly declared exception list is passed through `auditExceptions`                                                                                                                                                                    |

**Gate**: `npm run validate:all` passes, `npm test` passes, and every ported rule has been observed
failing on a planted violation before its script was deleted.

**Gate status (2026-08-06): PASSING.** `npm run validate:all` exits 0 — the first clean run on this
branch. It was blocked by 0.2, which predated this plan; closing that removed the last substitution.
Earlier tiers had been verified by running all 32 non-format steps individually, which is recorded
in their execution records rather than retro-labelled as a clean pass.

## Iterated approach (2026-08-06) — what execution changed

The original thesis was **mechanism mismatch**: guards hand-roll regex, ESLint has the AST, so move
Class A across. Executed, that thesis moved **1 of 8** guards. It was not wrong so much as keyed on
the wrong property — "is this a source pattern?" is not what decides where a check belongs.

### Three properties decide a check's home. The plan probed none of them.

| Property       | Question                                                      | Why it decides                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reach**      | What can the mechanism _see_?                                 | ESLint sees the lint root minus ignores. `tests/` is ignored, so a guard scanning it cannot move; `no-legacy-sidecars` reads `../cli/src`, `../hooks`, `../docs/**` and is outside entirely |
| **Relation**   | One file against itself, or two artifacts against each other? | Single-file shape → AST. Two artifacts → script. This is the original A/B split and it survives intact                                                                                      |
| **Resolution** | Literal match, or resolved path?                              | A literal module list **silently empties on rename** while staying green. A path-based rule follows the move — that is dependency-cruiser's job, not ESLint's                               |

Reach is the one that bit. It is invisible in the source of a guard — you have to read its `TARGETS`
constant and compare against the lint config's ignores, which is why the original probe missed it.

### Retire before you re-home — the option nobody costed

The plan offered two destinations (ESLint, script) and never asked the cheaper question: **does this
check still need to exist, and if it does, is there a home that makes it disappear?** Every guard
already carries a `RETIREMENT CONDITION`; none was evaluated.

`validate-no-tool-layer-validator-imports.js` says so in its own header — _"delete this guard when
`validate:arch` expresses the same edge as a dependency-cruiser layer rule. **That is strictly the
better home**"_ — and `.dependency-cruiser.cjs` already writes exactly that shape
(`from: { path: '^src/shared/' }` → `to: {...}` with `dependencyTypesNot: ['type-only']`). So the
correct move is neither of the two the plan offered: write the depcruise rule and **delete** the
guard. Ordering is **retire → re-home → keep**, cheapest first.

### Two properties the plan never modelled at all

**Report shape.** `validate:all` is an `&&` chain, so it reports the _first_ failure and hides the
rest. This session hit it three times — a `validate:format` failure masked 30 downstream steps, and
the only way to learn they passed was to run all 32 individually. That is not a reporting nicety: it
is why drift accumulated invisibly long enough for every count in the Inventory to go stale. 3.1
already exists for this; it is **higher priority than the remaining Class-A ports**, because it is
what makes the rest measurable.

**Inflow.** Nothing governs where a _new_ check lands. `validate-no-llm-client.js` (283 lines) landed
as a script during this plan's own lifetime — 4.4× Tier 1.1's entire target. Relocating eight guards
while the inflow is ungoverned is bailing without plugging. 0.3 covers this and should land with 3.1,
not after the ports.

### Measured cost — the efficiency case, which the plan asserted but never sized

`validate:all` runs **38.7 s** across 33 steps, and a single trivial guard invoked through npm costs
**138 ms** before its own work begins. Roughly 4.5 s of the total is npm/node process startup — a
step count is a wall-clock cost, not just chain noise. This is the measured argument for 3.1's runner
and for preferring homes that fold checks into a pass something else already makes (ESLint walks
`src/` once; depcruise builds the graph once) over homes that add a process.

### Exception hygiene is already live, not hypothetical

> **SUPERSEDED 2026-08-06 by the Tier 4.1 execution record.** The judgement held — this was live,
> it was the highest-value remaining item, and last was the right slot. The _sizing_ was wrong four
> separate times, and the last correction is the instructive one: every earlier miss was a
> **miscount of surfaces already named**, while the final one was a **surface never named at all**
> (`table-contracts.ts`, 5 entries). Re-measuring a list you already have will not find the list you
> forgot you had. The probe that found it was "what declares a suppression?", asked of the whole
> repo — not "how many entries are in these three files?".

4.1 is written as future work. It is present now: `validate-no-execution-mode.js` and
`validate-no-methodology-vocab.js` carry **18 allowlist entries between them**, each with its own
retirement condition and no mechanism to notice when one comes true. Every entry is a suppression
that outlives what it suppressed — the pattern `cleanup-standards.md` names. 4.1 is the highest-value
remaining item and its sequencing (last, because Class B must settle first) is the one thing the
original plan got right about it.

### Open unknowns — surfaced, not resolved

Load-bearing guesses this plan is still standing on. Each names what would close it, so none can
quietly become an assumption.

| Unknown                                                                                                                                 | Current default                                                                                                                                                                                                                                                                                                                                                                                | Closes when                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is `tests/` meant to be linted at all? The config claimed so for 7 months and nobody noticed it was inert                               | Treat as intentionally unlinted; recovery noted in config                                                                                                                                                                                                                                                                                                                                      | Someone states the intent, or the ratchet absorbs the measured 1,514 errors + 1,470 warnings                                                                                                                                                                                                    |
| Does `--self-test` still need to be a CLI flag now that Jest drives all 19?                                                             | Keep — the flag is the contract the harness spawns                                                                                                                                                                                                                                                                                                                                             | The harness stops spawning (needs 2.1a's entry-guard refactor), at which point the flag is dead                                                                                                                                                                                                 |
| Do the guards overlap each other or `validate:arch`? Never measured                                                                     | Assume no overlap                                                                                                                                                                                                                                                                                                                                                                              | A coverage comparison; `no-tool-layer-validator-imports` vs a depcruise rule is the first test case                                                                                                                                                                                             |
| **CLOSED 2026-08-06 (3.1): heavy steps, decisively.** Is `validate:all` dominated by the heavy steps or the process spawns?             | Default was "~4.5 s is spawn floor, rest is real work" — **confirmed, now per-step**: 6 steps carry 41.7 s of 46.5 s (lint:ratchet 19.9 · python 7.4 · typecheck:tests 5.6 · format 3.7 · state-field-writers 3.3 · arch 1.8). The other **24 steps total 4.6 s**, ≈190 ms each against a measured 138 ms npm floor — nearly all of their cost IS the spawn, and nearly none of the suite's is | Closed. Consequence: eliminating npm from every light step would save **under 5 s of 46.5 s**. That is why 3.1's runner still shells out to `npm run` instead of re-implementing npm's `.bin` PATH inside the one process the whole gate depends on                                             |
| **CLOSED 2026-08-06 (3.1): no step writes what another reads — and the example was wrong.** Would parallelising be safe?                | The parenthetical `generate:contracts --check` is **falsified**: `generate-contracts.ts:84` returns before the write in check mode. Every write call in all 30 steps sits behind `--update` / `--apply` / `--self-test`; the sole suite-mode writer is `validate:python` (ruff + pytest caches, both gitignored). Recorded per step as `io` in `SUITE`                                         | Closed on the write-conflict half. Parallelism deliberately NOT implemented: the remaining obstacles are CPU contention and interleaved output, and sequential output is what makes a failure attributable — the property 3.1 exists to deliver                                                 |
| **CLOSED 2026-08-06 (0.7): NO, it reports nothing.** Does dependency-cruiser report a `forbidden` rule whose `to.path` matches nothing? | Confirmed by a live instance, not a probe: `methodology-via-loader-only` has `to.path: "methodologies/"` (no such directory) and two `pathNot` exemptions naming a directory that does not exist. `validate:arch` passes and says nothing about it — 0 mentions in output. Row 0.9 deletes it                                                                                                  | Closed. Consequence for 1.2: the `tool-layer-no-validator-value-imports` rule it added carries a literal six-module `to.path`, so a rename silently shrinks its coverage with no signal. Its header already claimed "equal, not better, on rename fragility" — now measured rather than assumed |

### Revised ordering

| Was                          | Now                                                              | Why                                                          |
| ---------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| 1.2 port the remaining three | **1.2 triage all eight: retire / re-home / keep**                | There are not three; retirement was never costed             |
| 3.1 after 2.1                | **3.1 next** — runner + all-failures reporting                   | It is what makes every other measurement trustworthy         |
| 0.3 convention, unscheduled  | **0.3 with 3.1**                                                 | Inflow governance belongs with the gate that observes inflow |
| 4.1 last, hypothetical       | **4.1 last; sized 18 → 37 → 46 → measured 51 across 5 surfaces** | Already real; sequencing was correct, sizing never was       |

## Tier 5 — MCP prompt-authoring surface (deferred, separate domain)

**Deferred deliberately.** This is a defect in the prompt-authoring tooling, not in the validation
mechanism. It blocks one item here (the `strategicImplement` writeback) but shares no code, no
gate, and no reviewer with Tiers 0–4. Finalize validation first.

| #   | Status | Step                                                                                                                                                                                                                                                                                                                                       | Depends | Verification                                                           |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------- |
| 5.1 | ☐      | **`resource_manager` cannot update nested chain-step prompts.** `action:"update"` on a `parent/child` id fails with _"Mutation produced invalid resource state; restored previous files"_ — reproduced on `strategicImplement/validate` 3× including a description-only change. Top-level ids update fine. Rollback is clean; no data loss | —       | `resource_manager update` succeeds on a `parent/child` prompt id       |
| 5.2 | ☐      | Add the Durable Writeback phase to `strategicImplement/validate` — drafted 2026-08-06, blocked on 5.1. Manual edits under `server/prompts/**` are forbidden, so there is currently **no sanctioned path** to edit a chain step                                                                                                             | 5.1     | `strategicImplement` ends by routing findings to plan / skill / memory |

### This bug was already known, and that is the finding

`plans/sqlite-layer-remediation-2026-08-03.md` (lines 787–793, committed) records it verbatim:
_"New finding — `resource_manager update` cannot… `action:update` on
`implementation_plan/verification`… 'resource state; restored previous files'… call on the parent
succeeds… nothing was damaged."_

It was written into the plan that discovered it and nowhere else, so this session rediscovered it
from scratch — reproducing it three times, including a description-only probe, to establish what was
already documented. **A finding recorded only where it was found is a finding that will be found
again.** That is the same defect 0.4 fixes for tier execution, one level up: writeback needs a
destination that the _next_ reader consults, not just the plan that happened to be open.

## Execution record — Tier 1 (2026-08-05)

**Re-measured on execution.** Every count in the Inventory above had drifted: scripts 39 → 40,
`validate:all` steps 49 → 53, `:self-test` steps 17 → 19. Plugin wiring is `eslint.config.js:12`,
not `.mjs`. Tier 2.1's target is now 19 entries, not 17.

### The classification probe measured the wrong property

The inventory separated source-only from mixed with `rg -q 'existsSync|readdirSync.*resources|\.yaml|\.json'` — a test for **artifact reads**. It never probed **scan scope**. `no-stepstate` reads no artifacts, so it classified as source-only while `validate-no-stepstate.js:26` declares `TARGETS = ['src', 'tests']`.

**ESLint does not lint `tests/`.** Measured: `npx eslint tests/unit/.../runtime.test.ts` → _"File ignored because of a matching ignore pattern."_ `eslint.config.js` contradicts itself — line 209 opens `// TypeScript test files configuration` with `files: ['tests/**/*.ts']` and ~215 lines of rules, while line 425 declares a `files`-less `ignores` block containing `'tests/**'`, which in flat config is a global ignore and wins. That block has been dead since `0963d4ac` (2026-01-05).

Porting `no-stepstate` would therefore have silently halved its scope. Un-ignoring `tests/` to preserve it costs **1,514 errors + 1,470 warnings across 213 files** — a ratchet event unrelated to mechanism architecture. **New finding, needs its own tier or plan.**

### Corrected scope table (scan scope, the property that decides portability)

| Guard                             | Scan scope                                                  | Verdict                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-crosslayer-reexport`          | `src`, allowlist `src/types.ts`                             | **MOVED** — tests a file's own export shape; single-file by nature                                                                                 |
| `no-stepstate`                    | `src` + **`tests`**                                         | **STAYS** — ESLint cannot see `tests/`; port is strictly weaker                                                                                    |
| `no-tool-layer-validator-imports` | `src/mcp/tools`                                             | **RETIRED 1.2** — its own retirement condition was satisfiable; now `tool-layer-no-validator-value-imports` in `.dependency-cruiser.cjs`           |
| `no-prompt-gates-alias`           | one file, two literal expressions                           | **RE-HOME (row 1.5)** — superseding "STAYS pending"; it names none of the three properties, and `no-restricted-syntax` already expresses its shape |
| `no-legacy-sidecars`              | `src`, `../cli/src`, `../hooks`, `../docs/**`               | **STAYS** — reaches outside the lint root entirely                                                                                                 |
| `no-methodology-vocab`            | repo-wide ripgrep incl. `.md`/`.json`/`.yaml`, `resources/` | **STAYS** — reach; reads non-TS artifacts                                                                                                          |
| `no-crosslayer-relative`          | `src` only; resolves relative specifiers                    | **STAYS** — resolution, not artifact reads; the original grouping was wrong about why                                                              |
| `no-execution-mode`               | `src/modules/automation` + one `src` file                   | **RE-HOME (row 1.4)** — "artifact reads confirmed" was falsified; SCOPE is inside `src/` and its only I/O is ripgrep over those paths              |

**`validate-no-llm-client.js` (283 ln) was added by `d219f8b7` during this plan's own lifetime** — a new source-pattern guard, 4.4× Tier 1.1's target. It calls `existsSync`, so it lands in Class 1.3, not 1.2.

### Why 1.2 is left open

1.2 says "port the remaining three source-only guards." The corrected table shows there are not three: one cannot move (`no-stepstate`), one should move elsewhere (`no-tool-layer-validator-imports` → dependency-cruiser), and one is marginal (`no-prompt-gates-alias`). Marking 1.2 ✓ would require sweeping — the thing 1.3 forbids. **1.2 needs rewriting against the corrected table, not executing.**

### What landed

`claude/no-compat-reexport-shim` in `eslint-rules/claude-plugin.js`, wired at `eslint.config.js` with the script's `src/types.ts` allowlist and its retirement condition carried over verbatim. The AST version is also stricter: the script decided "pure re-export" via `/^(export\s|import\s|\}|\)|\{|type\s|[A-Za-z_$][\w$]*\s*,?$)/`, which accepts any bare identifier line — a multi-line object literal read as a re-export. A Program body node either is an import/export-from declaration or it is not.

**Falsification** (gate criterion): planted `src/__plant-shim.ts` → rule reported `4:1 error … claude/no-compat-reexport-shim`; the old script flagged the same file. Three negatives held at 0 reports — re-export without marker, marker + own definition (`infra/logging/index.ts` shape), import-only with marker. Plants removed.

**Measured after**: typecheck green · `validate:arch` OK, 445 modules · 163 suites / 1950 unit tests pass · `validate:all` 53 → 52 · new rule reports 0 against real `src/`.

**One gate not green, and not from this tier**: `lint:ratchet` reports `prettier/prettier baseline=0 current=1`. The single violation is `src/engine/gates/core/gate-validator.ts:546`, an uncommitted foreign working-tree change (5+/39−) belonging to a concurrent session. Excluding that one file, this tier contributes 0 prettier errors. Not fixed here — it is not this tier's work to touch.

## Why 4.1 is the highest-value item, despite being last

Five accepted exceptions went stale in a single session (2026-08-04): every table Tier 4 gave a
writer kept a passing `acceptedPhantomColumns` / `acceptedForeignWriters` entry until removed by
hand, because **an exception suppresses its finding whether or not it is still true**.
`verify-mcp-surface.mjs` detects this for its own exemptions. The two contract gates do not. Nothing
shares the concept.

That is an architecture symptom, not nine separate bugs: each script owns its own exception list, in
its own format, with its own hygiene rules. A shared harness makes it one rule instead of nine
reimplementations. It is sequenced last only because it is easier to design once Class B is the
only thing left in `scripts/`.

## Risks

| Risk                                                                                       | Mitigation                                                                                          |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| An ESLint rule is weaker than the script it replaces (scope, file globs, disable comments) | Plant a violation and observe the rule fail **before** deleting the script. Never delete on faith   |
| `eslint-disable` becomes an unaudited bypass the script never allowed                      | Decide per rule whether to allow disables; if not, the ratchet baseline is the audit trail          |
| Ratchet baseline churn as rules land                                                       | Land one rule at a time; the ratchet absorbs each move and shows the delta                          |
| Touching `package.json` while another workstream edits it                                  | Same constraint F5 Tier B recorded: gate on `git status --short -- server/package.json` being empty |

## Decisions

| Decision            | Chosen                                     | Rejected          | Why                                                                                                          |
| ------------------- | ------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Where Class B lives | Stays in `scripts/`                        | Force into ESLint | ESLint is single-file; it cannot compare two artifacts. Forcing it produces a worse check, not a better home |
| Migration shape     | One rule at a time, observed failing first | Bulk port         | A bulk port cannot prove each rule is as strong as what it replaced                                          |
| Scope of Tier 1     | The 4 source-only guards                   | All 8             | Measured: 4 read non-TS artifacts and cannot move wholesale                                                  |
| Sequence            | Mechanism first, harness last              | Harness first     | The harness design depends on what remains in Class B                                                        |

## Not in scope

- The `server/package.json` commit blocker (five untracked release scripts) — that is the
  release workstream's, and F5 Tier B already records the gating condition
- Anything F5 settled: CI wiring, retirement conditions, dead aliases

## Execution record — Tier 2.1 (2026-08-05)

**Count corrected: 19, not 17.** All 19 were in `validate:all`; all pass; total runtime ~2.6 s
(slowest `validate:state-field-writers:self-test` at 561 ms).

### Why the harness spawns rather than imports

The row asked for the assertions to run "with coverage". Probed for the actual entry-guard idiom
(`import.meta.url ===` / `require.main ===`), **18 of 19 scripts are unguarded** — they call
`main()` at module scope and `process.exit()` on failure. Only `classify-validation-scope.js`
guards its entry. Importing one into a Jest worker executes it and then kills the worker.

An earlier probe for a bare `import.meta.url` substring reported 13 as guarded. That was a false
positive: those files use `fileURLToPath(import.meta.url)` for path resolution, not entry guarding.
**Grep the behavior, not a token that appears in it.**

So "with coverage" — read as instrumenting script internals — would require refactoring the entry
point of every safety-net script in the repo, in one change, against the plan's own "one at a time,
observed failing first" discipline. **Decision: spawn, and drop the coverage clause.** A self-test
already asserts that its checker can still fail; line coverage of a checker's internals adds no
signal that assertion does not already carry. The verification column now states what is true.

### The work list is derived, not written

`tests/unit/scripts/validation-self-tests.test.ts` enumerates `*:self-test` keys from
`package.json` at run time. A newly added self-test script is covered the moment it exists and
cannot be forgotten — the failure mode that let `validate-no-llm-client.js` ship as a 19th entry
nobody tracked. A guard test asserts the derivation found a non-empty list, so a filter that
silently matched nothing fails loudly instead of passing vacuously.

### Falsification

Planted `zzz-planted:self-test` (`node -e "process.exit(1)"`) in `package.json`. The harness
**auto-discovered it and failed**: `zzz-planted:self-test exited 1`, `1 failed, 20 passed`. That
single fixture proves both properties at once — drift-proof discovery and failure propagation.
Plant removed; `package.json` verified free of formatting drift afterwards.

### Enforcement is preserved, not relocated out of CI

Removing steps from `validate:all` breaks the contract if nothing else runs them. Checked:
CI runs `validate:all` (`ci.yml:159`) **and** `test:ci` (`ci.yml:354`); `.husky/pre-push:86` runs
`test:ci`. Both routes still execute all 19.

**Measured after**: `validate:all` 52 → **33 steps**, passes · typecheck green ·
`typecheck:tests:ratchet` 385 errors, no regressions · `lint:ratchet` 3196/1033, no regressions ·
**164 suites / 1970 tests pass** (+1 suite, +20 tests).

## Execution record — Tier 0.3 (2026-08-06)

**Verdict: a recorded convention AND a check — the row allowed either, and a convention with no
enforcement is the exact failure this plan's §"This bug was already known" section documents.**

### The convention

A `validate-no-*` guard must state, in a header comment, which property forces it to be a
standalone process:

```
MECHANISM: script — reach|relation|resolution — <what it reads or resolves>
```

The vocabulary is closed and is the same three properties the iterated approach named. A guard that
cannot name one is a source-pattern check and belongs in `eslint-rules/claude-plugin.js`.

### The check lands in ESLint, not in `scripts/`

`claude/require-guard-mechanism-verdict`, wired against `files: ['scripts/validate-no-*.js']`.
Writing it as a script would have made it #40 enforcing "do not add #40". Measured basis for the
choice, not preference: ESLint already lints `scripts/**/*.js` (probed — `npx eslint
scripts/validate-no-llm-client.js` returns real findings, so **reach** is satisfied), the check is
single-file (**relation**), and it matches a literal marker (**resolution** needs nothing more). It
therefore folds into a pass already being made and adds no process to the 33-step chain.

Rejected: extending `require-file-lifecycle` with a second annotation — different vocabulary,
different file set, different failure meaning. The plugin holds five narrow rules rather than one
wide one, and overloading options to serve two conventions makes both harder to read.

### The allowlist is the pre-existing eight, and it announces its own retirement

0.3 governs **inflow**; the eight existing guards are 1.2's verdicts to issue. Assigning them
provisional verdicts here would have been the untrusted-inventory error again — guessing where 1.2
must measure. So all eight are allowlisted in `eslint.config.js`, each retiring when its guard
states a verdict.

The rule reports an allowlisted guard that **now carries** a verdict as a stale entry
(`staleAllowlistEntry`), so 1.2's progress is self-announcing rather than tracked by hand — the
`verify-mcp-surface.mjs` satisfied-exception pattern that `cleanup-standards.md` names and that 4.1
generalises. **Blind spot, recorded as row 0.5**: a rule only visits linted files, so an entry
naming a _deleted_ guard is never reported.

### Falsification

Rule logic, `tests/unit/eslint-rules/require-guard-mechanism-verdict.test.ts` (RuleTester, 7 cases —
the first test of any rule in this plugin; the other five are verified only by hand-planted
violations). Two mutations, each failing exactly one test: neutering the `missingReason` branch →
1 failed / 6 passed; neutering `staleAllowlistEntry` → 1 failed / 6 passed. Distinct mutations,
distinct failures.

Wiring, by planted file: `scripts/validate-no-plant.js` with no marker → `1:1 error …
require-guard-mechanism-verdict`; the same file with a valid marker → 0 reports; an allowlisted
guard given a verdict → `staleAllowlistEntry` fired. Plants removed; `scripts/` shows only 1.1's
deletion afterwards.

### Criteria → tests (`all_criteria_mapped: yes`)

| Criterion                                      | Test                                          |
| ---------------------------------------------- | --------------------------------------------- |
| New guard with no marker is flagged            | invalid: `missingVerdict` · planted file      |
| Property outside the vocabulary is flagged     | invalid: `unknownProperty`                    |
| Marker with no reason is flagged _separately_  | invalid: `missingReason`                      |
| A valid marker passes                          | valid ×2 (incl. case-insensitive property)    |
| Allowlisted guard with no marker is exempt     | valid                                         |
| Allowlisted guard that gains a marker is stale | invalid: `staleAllowlistEntry` · planted file |

### Measured after

`typecheck` green · `lint:ratchet` 3193/1033, no regressions (down 3 from 3196) ·
`typecheck:tests:ratchet` 385 errors, no regressions · **165 suites / 1975 tests pass** ·
`validate:all` **EXIT 0**, still 33 steps — the check added no chain step.

`eslint-rules/claude-plugin.d.ts` was added because the plugin is plain JS and the TS test's import
resolved to `any` (TS7016). A declaration rather than a per-call-site cast: same assertion, visible
in one place, and available to the next test.

### Divergences logged during execution

1. **`4.4× Tier 1.1's target` was stale** — computed against `no-stepstate` (64 ln), which 1.1
   abandoned. Against 1.1's actual target (`no-crosslayer-reexport`, 100 ln) it is 2.8×. Corrected
   in the row.
2. **"eight guards" survived a substitution** — F3 above.
3. **`no-execution-mode` was misfiled as Class B** — its `SCOPE` is `['src/modules/automation',
'src/shared/types/automation.ts']`, both inside `src/`, and its only I/O is ripgrep over those
   paths. No artifact reads. Verdict withdrawn in the corrected scope table; 1.2 decides.
4. **Six pre-existing lint errors** in `scripts/validate-no-*.js` (3 `no-undef`, 3
   `no-useless-escape`), all absorbed by the ratchet baseline and none from this rule. Not this
   tier's to fix.

## Execution record — Tier 1.2 (2026-08-06)

**Retire → re-home → keep, applied in that order to all eight.** The ordering paid: the cheapest
option removed the guard the original plan had scheduled for the most expensive one.

| Guard                             | Verdict               | Reason                                                           |
| --------------------------------- | --------------------- | ---------------------------------------------------------------- |
| `no-tool-layer-validator-imports` | **RETIRE** — deleted  | Retirement condition was satisfiable today                       |
| `no-stepstate`                    | KEEP — reach          | Scans `tests/`, globally ignored by ESLint                       |
| `no-legacy-sidecars`              | KEEP — reach          | `../cli/src`, `../hooks`, `../docs/**` are outside the lint root |
| `no-llm-client`                   | KEEP — reach          | `../cli/src` alongside `src/`                                    |
| `no-methodology-vocab`            | KEEP — reach          | Repo-wide over `.md`/`.json`/`.yaml`, which no linter parses     |
| `no-crosslayer-relative`          | KEEP — resolution     | Layer crossing is a property of the resolved path                |
| `no-execution-mode`               | **RE-HOME** → row 1.4 | Scope is entirely inside the lint root; names no property        |
| `no-prompt-gates-alias`           | **RE-HOME** → row 1.5 | Two literal expressions in one file; `no-restricted-syntax` fits |

Each keep verdict is written into its guard as a `MECHANISM:` marker, so the verdict lives where
the next reader of that file will hit it rather than only in this plan — the failure documented in
§"This bug was already known".

### The retirement was not a lateral move, and it is stronger than its own header claimed

`.dependency-cruiser.cjs` gains `tool-layer-no-validator-value-imports`. Falsified against planted
files: a value import in `src/mcp/tools/` **fired**; a `import type` **did not**; a file under
`src/mcp/tools/schemas/` **did not** (that directory owns MCP parameter validation per
`.claude/rules/mcp-contracts.md` — a different boundary).

Two forms reached a forbidden module and the deleted script reported _"Tool-layer validator
boundary check passed"_ while dependency-cruiser reported both:

- an `export … from` re-export placed in the tool layer — the script only matched `^import … from`
- `await import(…)` — the script's regex is static-import-shaped

**But the header's stated reason for preferring depcruise was partly wrong.** It claimed a
path-based rule "follows the move" where a literal module list "silently empties on rename". The
new rule's `to.path` is _also_ a literal list, and a renamed schema module empties it just as
quietly. The real gain is specifier-form coverage, measured above. Recorded in the rule's comment
rather than inherited — a retirement condition can be right about the destination and wrong about
the reason.

### 0.3's satisfied-exception check earned itself on its first real use

Writing the five `MECHANISM:` markers made ESLint report **exactly five** `staleAllowlistEntry`
errors, naming each entry that had just become a lie. No hand-tracking, no checklist. That is the
`cleanup-standards.md` pattern working in production rather than as a principle.

**And row 0.5's blind spot was confirmed the same run.** Deleting
`scripts/validate-no-tool-layer-validator-imports.js` left its allowlist entry orphaned, and
nothing reported it — a rule only visits files that are linted, and that file no longer exists. It
was removed by hand. 0.5 stands, with evidence.

### Enforcement is preserved, not dropped

`validate:no-tool-layer-validator-imports` is gone from `validate:all` (33 → 32 steps), and the
boundary it defended is now checked by `validate:arch`, which was already in the chain and in CI.
Net effect on the gate: one fewer process, strictly more coverage. The guard had no `:self-test`
entry, so 2.1's derived Jest work-list needed no edit — it re-derives from `package.json` on every
run.

### Criteria → verification (`all_criteria_mapped: yes`)

| Criterion                                       | Verification                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| A verdict per guard, with its reason            | Table above; 5 also written as in-file `MECHANISM:` markers        |
| Retire before re-home before keep               | The one satisfiable retirement was taken first and deleted         |
| Satisfiable retirement is deleted, not moved    | Guard file `git rm`'d; npm script and chain step removed           |
| Replacement is not weaker than what it replaced | 3 planted positives/negatives + 2 evasion cases the script missed  |
| Re-home verdicts do not silently become keeps   | Rows 1.4 and 1.5; both stay allowlisted with the row as their exit |

### Measured after

`typecheck` green · `validate:arch` OK, 445 modules · `lint:ratchet` 3193/1033, no regressions ·
`typecheck:tests:ratchet` 385, no regressions · **165 suites / 1975 tests pass** ·
`validate:all` **EXIT 0**, 32 steps · all five kept guards still exit 0 with their markers added ·
guards 8 → **7**, 954 → **881** lines.

### Divergences logged during execution

1. **The originating claim's destination was wrong, not just its count** — it scheduled
   `no-tool-layer-validator-imports` as an ESLint port (~298 ln of "source-only" guards). It
   retired to dependency-cruiser instead. Marked superseded in place.
2. **`no-prompt-gates-alias` "STAYS pending" is superseded** — "gains nothing from an AST" is a
   cost argument, not a mechanism one. Under 0.3's convention it names no property, so it is a
   re-home. Creating an exception to that convention one day after establishing it would have made
   the convention advisory.
3. **The guard's own retirement rationale was half wrong** — see above. The condition was still
   satisfiable, so the verdict stands; the reason did not survive measurement.

## Execution record — Tier 0.5 (2026-08-06)

**The row asked for a detector and got a deletion instead.** Its Verification read _"An allowlist
entry naming a nonexistent file is reported — folds into 4.1's shared harness rather than being
solved twice."_ Building that detector inside the ESLint rule is not possible, and building it
outside would have been the second one-off the row forbids. So the state it detects was removed.

### Why the detector could not live in the rule

An ESLint rule is instantiated per linted file. To report a stale entry it would have to run on
some file — and the degenerate case is the one that matters: **if every guard were deleted, the
glob `scripts/validate-no-*.js` would match nothing, the rule would never run, and an allowlist of
entirely-dead entries would report nothing.** The failure mode scales with how stale the list is,
which is backwards. This is the same fact 1.2 hit by accident when a retired guard orphaned its
entry and nothing caught it.

### What replaced it

A second disposition. The marker grammar is now:

```
MECHANISM: script — reach|relation|resolution — <what it reads or resolves>
MECHANISM: rehome — eslint|dependency-cruiser|jest — <plan row that owns the port>
```

A guard pending a move declares `rehome` **in itself**. The `allowlist` option is gone from the
rule and the config block carries no per-file exemption at all. An in-file marker is deleted by the
same `rm` that deletes the guard, so a stale exemption is not detected late — it is unrepresentable.

`staleAllowlistEntry` retired with it. It was correct and it worked (1.2's five markers produced
exactly five reports), but it existed only because the verdict lived in two places. One place needs
no reconciliation check.

**Qualifiers are validated per disposition, not pooled** — `rehome — reach` is rejected, because
`reach` is a reason to stay a script, not a destination. A `rehome` verdict must also carry its
reason, so `MECHANISM: rehome — eslint` alone cannot be used as a bypass.

### Falsification

9 RuleTester cases (was 7). Two mutations:

- **pooling the qualifier vocabularies across dispositions** → 2 failed / 7 passed. Not a weak
  test: pooling makes `qualifiers[disposition]` never `undefined`, so it removes the
  disposition check as a side effect and an unknown disposition stops being reported at all. Both
  failures are the mutation's real consequences.
- **accepting any disposition** → 1 failed / 8 passed, exactly the `unknownDisposition` case.

Live check: all seven guards report 0 under the rewritten rule, and `eslint.config.js` contains no
`allowlist` key for it.

### Criteria → tests (`all_criteria_mapped: yes`)

| Criterion                                           | Test                                                   |
| --------------------------------------------------- | ------------------------------------------------------ |
| A stale exemption cannot outlive its subject        | No allowlist exists; verified by grep + 7 guards clean |
| `rehome` is a first-class verdict, not an exemption | valid: rehome case; invalid: rehome without reason     |
| Qualifiers do not leak between dispositions         | invalid: `rehome — reach`                              |
| An unknown disposition is distinguishable           | invalid: `unknownDisposition`                          |
| Everything 0.3 asserted still holds                 | 5 of the 9 cases are 0.3's, re-run unchanged           |

### Measured after

`typecheck` green · `lint:ratchet` 3193/1033, no regressions · `typecheck:tests:ratchet` 385, no
regressions · **1977 tests pass** (+2) · `validate:all` **EXIT 0**, 32 steps · guards still 7, all
carrying an in-file verdict (5 `script`, 2 `rehome`).

### Divergence: the same blind spot has a second instance, now row 0.6

`claude/no-compat-reexport-shim` still carries `allowlist: ['src/types.ts']`, and that entry's
retirement condition is the file's own deletion — so satisfying it orphans the entry silently.
Left as a row rather than fixed here: 0.5's scope is the guard-verdict rule, and 0.6 should choose
deliberately between 0.5's in-file form and 4.1's harness rather than inherit one by proximity.

## Execution record — Tiers 1.4 + 1.5 (2026-08-06)

Both rows were "port a guard into ESLint." Both ported. In both cases the row's stated _cost_ was
wrong, and in one case the guard being ported had not worked for five months.

### 1.5 — the guard was vacuous, and its own file is the proof

`validate-no-prompt-gates-alias.js` pinned two literal expressions:

```
gateConfiguration:\s*args\['gate_configuration'\]\s*\|\|\s*args\.gates
args\.gates\s*\|\|\s*currentPrompt\?\.gateConfiguration
```

Its target file has contained this since **2026-03-18** (`git blame`, commit `5a2800e6f`):

```ts
// gate_configuration has alias handling (special case)
if (args.gate_configuration !== undefined || args.gates !== undefined) {
  promptData.gateConfiguration = args.gate_configuration ?? args.gates;
}
```

That is the aliasing the guard names in its own header — and the guard exits 0 on it. The guard
landed **2026-03-11**; the defect returned **one week later**, spelled `??` instead of `||` and with
dot access instead of bracket access. Neither regex matches. It has reported "No legacy prompt gate
alias usage found" ever since.

> **SUPERSEDED by 1.6's measurement (2026-08-06). The paragraph above is wrong in the direction that
> flatters the guard**, and that error is the reusable part: it assumed a check which is green now
> must have been working once. Measured timeline —
>
> | Date           | Event                                                                                                                                                       |
> | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | **2026-03-11** | Guard added (`913c2d9d`). Both forbidden patterns were **already in the target file** (lines 117, 220), and the guard was **not wired into `package.json`** |
> | **2026-03-18** | `5a2800e6` reformats the line `                                                                                                                             |     | `to`??`, preserving the alias |
> | **2026-07-29** | `4f25843f` finally wires the guard into `validate:all` — by which time the regexes no longer matched it                                                     |
>
> The defect did not "return": it never left, and it **predates the guard**. The guard went from
> **unwired** straight to **vacuous** with no intervening working state — it has never once reported
> the thing it was written for. "Stopped observing its target" was too generous; it never started.

**The lesson is not "regexes are brittle."** It is that the guard pinned a _formatting_ of the
defect while its own header described a _shape_. Everything needed to catch this was already
written down in the guard — the header says "re-aliasing `args.gates` onto `gateConfiguration`",
which is operator-independent. The regexes narrowed that to two spellings, and the gap between
what a check says it does and what it observes is invisible while it is green.

This is the plan's own thesis arriving as a measured instance rather than an argument: **a check is
evidence only about what it observes**, and nothing in a green run distinguishes "no defect" from
"defect written differently."

### Why the port could not be faithful

Porting the two regexes verbatim into `no-restricted-syntax` would have carried the blind spot
forward and passed row 1.5's verification — a planted `|| args.gates` would be reported, and the
live `??` instance would not. Green, and about nothing.

So the port matches the shape instead: `args.gates` as a direct operand of `||` or `??`. That
selector _does_ report the live line, which is why this tier ends with an exemption rather than a
silent pass. The exemption is sited at the defect with its retirement condition, and row 1.6 owns
the decision it is waiting on.

**Not fixed here, deliberately.** `gates` is a reachable member of the documented tool-surface
union; dropping it narrows the union, which CLAUDE.md prices as a major bump. That is a contract
decision, not a lint cleanup, and this tier has no mandate to make it.

### 1.4 — the allowlist did not need porting, because prose is not code

The row costed the port at "seven allowlist entries, which become rule options." Measured: **ten**
entries. Probing which ones are load-bearing — _does this entry suppress a real hit_, not _does it
name a real file_ — found **three that are not**:

| Entry                                               | Finding                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `validate-no-execution-mode.js` / `mode`            | **Unreachable.** The guard's `SCOPE` never visited `scripts/`                    |
| `package.json` / `validate-no-execution-mode`       | **Unreachable.** Same — `SCOPE` is two `src/` paths                              |
| `.../tool-detection-service.ts` / `non-strict mode` | **Redundant.** `'non-strict mode'` contains `'strict mode'`, already allowlisted |

Two entries were written against a mental model of a repo-wide scan that the guard never performed.
They are the _third_ instance in this plan of the satisfied-exception class (after 1.2's orphaned
allowlist entry and 0.6's `src/types.ts`) — and the first where the exception was never live at all,
rather than becoming stale later. **An exception can be born dead**, and no gate reports it.

Then the port made the question moot. The script matched text, so comments and string literals hit
too — which is where most of the allowlist came from (`confirm mode`, `strict mode`,
`(mode, trigger, strict)` are all prose). An AST rule matching property positions cannot see prose,
so those entries have no successor. **10 rule options → 0.** What survives is the deprecation fold,
expressed as two `ignores` paths in `eslint.config.js` — ESLint-native scoping rather than a
bespoke allowlist, which is the shape 0.5 argued for.

### A trap that would have silently weakened both ports

In ESLint flat config, a later block **replaces** a rule's options rather than merging them. Both
targets are covered by `files: ['src/**/*.ts']`, which owns the existing `no-restricted-syntax`
array. A file-scoped block adding one selector would have **dropped the `ChainExecutor` and
`ConsolidatedPromptEngine` selectors for exactly the file being tightened** — a net loss of
enforcement, reported by nothing.

Avoided two different ways: 1.4 uses a distinct rule name (no shared options to replace), and 1.5's
selector was measured safe repo-wide (`args.gates` is a direct `||`/`??` operand in exactly one
place in `src/`) so it joins the existing array instead of a new block. Recorded because it applies
to **every** future re-home into a shared-options rule, including row 1.5's sibling candidates.

### Satisfied-exception detection already exists for one exception form

While siting the exemption, ESLint reported:

```
Unused eslint-disable directive (no problems were reported from 'no-restricted-syntax')
```

That is exactly the check rows 0.6 and 4.1 are trying to build — an exception whose condition no
longer holds, reported as a finding — and it is free for any exception expressed as an
`eslint-disable`. It does not generalise to allowlist arrays or `acceptedForeignWriters`, so 4.1
still has work. But it is a real data point for 0.6's open choice: **an exception moved into ESLint
gets stale-detection that an exception in a config array does not.**

### Criteria → tests (`all_criteria_mapped: yes`)

| Criterion (from both rows)                           | Test                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| 1.4 guard deleted                                    | `ls scripts/validate-no-*.js` → 5; no `package.json` refs   |
| 1.4 rule fires on planted `mode:` usage              | live plant + RuleTester `mode as an object property key`    |
| 1.4 bracket/computed/shorthand forms fire            | 3 RuleTester invalid cases + live plant                     |
| 1.4 TS interface member fires                        | RuleTester TS case (separate tester — espree cannot parse)  |
| 1.4 prose/strings do **not** fire (allowlist shrink) | 6 RuleTester valid cases, each a hit the script allowlisted |
| 1.4 survivors still pass                             | `npx eslint` over automation scope → 0 findings             |
| 1.5 guard deleted                                    | same absence check                                          |
| 1.5 planted `\|\| args.gates` reported               | live plant, both old-guard shapes                           |
| 1.5 the `??` form reported (what the script missed)  | live: real line 254 reported before exemption               |
| 1.5 `&&` form not reported (legitimate use)          | live plant + `prompt-executor.ts` stays clean               |

### Falsification

| Mutation                                           | Result                                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| M1 — drop the computed `MemberExpression` selector | **1** test fails: the bracket-access case                                                       |
| M2 — drop the `TSPropertySignature` selector       | **1** test fails: the TS interface case                                                         |
| M3 — broaden to any `Identifier[name='mode']`      | **5** tests fail, all valid cases — the text-matching regression the valid cases exist to catch |

M1 and M2 are narrow mutations and fail exactly one test each. M3 is deliberately broad and fails
broadly; that asymmetry is the intended shape, not a weak-test signal.

### Measured after

`typecheck` green · `lint:ratchet` 3193/1033, no regressions · `typecheck:tests:ratchet` 385, no
regressions · **1990 tests / 166 suites** (+13, +1) · `validate:all` **EXIT 0**, **30 steps** ·
guards **5** · custom ESLint rules **7** · `no-restricted-syntax` selectors **4**.

### Divergences logged during execution

1. Row 1.4's "seven allowlist entries" → **10**, of which 7 load-bearing, of which **0** needed to
   become rule options.
2. Row 1.5's "config-only, adds no rule code" → **held, for the wrong reason**. The row credited
   the existing `no-restricted-syntax` block; what actually made it config-only was that the
   selector proved safe repo-wide. Had it not been, the replacement trap would have forced either
   duplication or a shared-selector extraction.
3. Line counts 98/51 → **102/55**, drift caused by this plan's own tier 1.2.
4. Row 1.5's verification as written (`planted || args.gates is reported`) is **satisfiable by a
   port that carries the five-month blind spot forward**. It was met, and separately the `??` form
   was verified — the row's own criterion was not sufficient to establish the port was not vacuous.

## Execution record — Tier 0.6 (2026-08-06)

The row offered two ways to make a stale exemption detectable. **Neither was the answer.** The
exemption did not need to become detectable; it needed to be gone, and had for some time.

### The retirement condition was already met, in writing, and nothing said so

`eslint.config.js` carried the condition verbatim beside the entry:

> when no file imports from `src/types.js`, delete both the file and this entry

Measured 2026-08-06, three independent probes — the property is _has consumers_, resolved rather
than textual:

| Probe                                        | Result                                         |
| -------------------------------------------- | ---------------------------------------------- |
| `depcruise` incoming edges to `src/types.ts` | **0 dependents**                               |
| `rg` for any specifier resolving to it       | **0** (all `types.js` hits are `cli/src/lib/`) |
| `knip`                                       | lists `src/types.ts` as unused                 |

So the file was dead, the entry was a lie, and every gate was green. This is the same class 1.2 and
1.4 hit, now with the sharpest form yet: **the exception carried its own exit condition, the
condition was satisfied, and satisfaction is exactly the state nothing observes.** A retirement
condition makes an exception _retirable_; it does not make anyone notice it became retirable.

### `validate:arch` structurally cannot catch this file

`no-orphans` requires no incoming **and** no outgoing edges. A re-export always has outgoing edges,
so `depcruise` reported `orphan: false` on a file with zero dependents — measured, not inferred.
CLAUDE.md documents this blind spot; this is a live instance of it. `knip` is the only gate in the
suite that could see it, and `knip` is not in `validate:all`.

### What was removed, and the one it created

Deleting the file orphaned a **third** exception elsewhere: `validate-no-llm-client.js` held an
`acceptedException` for `src/types.ts`. Notably that guard has good hygiene — every entry carries a
`closedBy` — and it still went stale the moment the file went away. **`closedBy` is a promise about
the future, not a check.** Removed in the same change, found by the removal sweep rather than by any
gate.

Five sites moved together: the file, the ESLint allowlist entry, the `lifecycleAnnotationTargets`
glob, the `no-llm-client` exception, and prose in `core-config.ts` that described the deleted module
as if it existed. The prose was rewritten to keep the _reason_ the split happened — the barrel cycle
it prevents is still real — without pointing at a file that is gone.

### The `allowlist` option was removed, not left empty

With its last entry deleted the option would have sat permanently at its baked value, which
`cleanup-standards.md` prices as a parallel system with a nicer name. Removed from the rule's schema
and its `create()`.

The fallback is **stronger**, not weaker: a future exemption uses `eslint-disable`, and ESLint
reports `Unused eslint-disable directive` once it stops being needed. That is the satisfied-exception
detection 4.1 is chartered to build, free, for every exception expressed that way. **A config array
cannot offer it and never could** — which reframes 4.1 as a problem only the surviving _scripts_
still have.

### Criteria → verification (`all_criteria_mapped: yes`)

| Criterion                                          | Check                                                  |
| -------------------------------------------------- | ------------------------------------------------------ |
| Deleting `src/types.ts` leaves no exemption behind | 5 dependent sites swept and removed; `rg` clean        |
| The rule still fires without the option            | planted compat shim reported (1)                       |
| The rule still ignores a markerless barrel         | planted markerless barrel reported (0)                 |
| Nothing consumed the deleted module                | depcruise 0 dependents · rg 0 specifiers · knip unused |
| Build does not reference it                        | `npm run build` EXIT 0                                 |

### Measured after

`typecheck` green · `lint:ratchet` 3193/1033, no regressions · `typecheck:tests:ratchet` 385, no
regressions · **1990 tests / 166 suites** · `validate:all` **EXIT 0**, 30 steps · `build` EXIT 0 ·
depcruise **444 modules** (was 445) · **0 `allowlist:` options remain in the plugin** — 0.5 removed
one, 0.6 the other.

### Divergences logged during execution

1. The row's premise ("make it detectable") was **wrong in a useful direction**: retire-before-rehome
   applies to exceptions too, not just guards. Third consecutive tier where the cheapest option was
   the one the row had not listed.
2. Deleting one exception created another (`no-llm-client`), and the guard that grew it has
   `closedBy` on every entry. Hygiene fields do not substitute for detection.
3. 4.1's sizing was **18 live entries**; re-measured **37** (`no-methodology-vocab` alone holds 34).
   Corrected in place. New row **0.7** opened for that guard specifically, because 34 entries is not
   a sub-task of a harness — it is a triage of the same shape 1.4 ran on ten.

## Execution record — Tier 1.6 (2026-08-06)

A decision row. The decision was **unintended, remove it** — taken by the operator on measured
evidence, not inferred.

### What settled it was an asymmetry, not the contract argument

1.5's exemption comment claimed `gates` was "a reachable member of the documented tool-surface
union", making removal a major-version break. **That was over-claimed.**
`tooling/contracts/resource-manager.json` declares `gates` as `[Framework]` and `gate_configuration`
as `[Prompt]`; nothing ever declared that a prompt update accepts `gates`. It was reachable but
undeclared — a different thing, and a weaker claim on protection.

The fact that actually decided it:

| Path                 | Accepts `gates`?                           |
| -------------------- | ------------------------------------------ |
| `createPrompt` (121) | **No** — `args['gate_configuration']` only |
| `updatePrompt` (270) | **Yes** — `?? args.gates`                  |

A client passing `gates` on create silently gets nothing; the same client passing it on update gets
it applied. Nobody designs that. Add undocumented, untested, and introduced as a side effect of
`fix(mcp-tools): fix prompt update field clearing`, and "accident" is the only reading left.

### The guard was never right, and 1.5's record said otherwise

Correcting the previous tier's own execution record — see the superseded block above. Measured:
both forbidden patterns were **already in the target file at the guard's own commit**, and the guard
was **not wired into `validate:all` until 2026-07-29**, 4.5 months later, by which point the code
had been reformatted past its regexes.

**1.5 assumed a guard that is green now must have been working once.** It never was. Worth stating
plainly because the same inference is available on every green check in this repo, and it is not
free — "when did this check last actually fail?" is a different question from "does it pass?", and
only the first one distinguishes a working guard from a decorative one.

### A test had encoded the accident as a decision

`section-update.test.ts` asserted:

```ts
it("does not include gate_configuration (has alias handling)", () => {
  expect(UPDATE_FIELDS).not.toHaveProperty("gate_configuration");
});
```

It documented the implementation as though it were a design choice, and reading it first would make
the alias look deliberate. Inverted, with the reasoning recorded rather than replaced. **An
exclusion assertion should say what would make the thing includable** — otherwise it freezes an
implementation detail into apparent intent.

This is the counter-evidence to the "unintended" verdict, and it is recorded as such rather than
omitted: a test did claim the alias was on purpose. It lost to the create/update asymmetry, which is
behaviour rather than commentary.

### Criteria → tests (`all_criteria_mapped: yes`)

Two behaviours in the change, so two criteria — the removal, and the regression it risks.

| Criterion                                              | Test                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| `gate_configuration` still updates via `UPDATE_FIELDS` | `updatePrompt … still updates through UPDATE_FIELDS`         |
| `gates` no longer accepted on a prompt update          | `the [Framework] gates parameter is no longer accepted`      |
| The 1.5 selectors pass with no suppression             | `npx eslint` on the file — 0 findings, 0 unused-disable      |
| The selectors still fire                               | planted `args.gate_configuration ?? args.gates` reported (1) |
| `UPDATE_FIELDS` shape is current                       | `section-update.test.ts` inverted assertion                  |

### Falsification

| Mutation                              | Result                                                  |
| ------------------------------------- | ------------------------------------------------------- |
| M1 — revert the `UPDATE_FIELDS` entry | **1** test fails: `still updates through UPDATE_FIELDS` |
| M2 — re-introduce the alias fold      | **1** test fails: `gates … no longer accepted`          |

Each mutation reddens exactly the test written for it.

### Measured after

`typecheck` green · `lint:ratchet` 3193 errors / **1027** warnings (down from 1033 — the deleted
lines carried six `no-unsafe-member-access` warnings) · `typecheck:tests:ratchet` 385, no regressions
· **1992 tests / 166 suites** (+2) · `validate:all` **EXIT 0**, 30 steps · `build` EXIT 0.

### Divergences logged during execution

1. **1.5's exemption comment over-claimed the contract position.** `gates` on a prompt action was
   reachable but never declared. Corrected here rather than left standing.
2. **1.5's timeline was wrong**, and wrong in the flattering direction. Superseded in place above.
3. **`UPDATE_FIELDS` did not contain `gate_configuration`**, so deleting the fold outright would have
   broken `gate_configuration` updates entirely. The field had to move into the map, not vanish —
   caught before the edit by reading the map rather than assuming the loop already covered it.
4. **An existing test pinned the old behaviour** and had to be inverted. It was the only artifact in
   the repo arguing the alias was deliberate.

## Execution record — Tier 0.7 (2026-08-06)

The triage found 3 removable entries out of 37. It also found that **my own probe had the bug this
plan is about**, and that the guard cannot see 57 of the repo's tracked files.

### The probe committed F2 on its first run

The first probe parsed `ALLOWLIST` with a regex over the file's source, and reported **38** entries
with `{ file: 'tests/', match: 'methodolog' }` among them — a blanket entry covering the whole test
tree. That entry does not exist. It appears **inside a comment**, quoted verbatim by the block
explaining why it was removed:

> This was a single blanket `{ file: 'tests/', match: 'methodolog' }`. That exempted the whole test
> tree, so 18 stale `methodology` assertions in tests/integration survived…

The phantom then "covered" all ten per-file test entries, so the run reported **12 redundant**
entries. Deleting them on that evidence would have restored precisely the blanket exemption the
guard's comment says caused four suites to fail against correctly-renamed production.

**This is F2 exactly** — probing a token that co-occurs with the property (`text shaped like an
entry`) instead of the property (`is an entry`). The plan states that rule and I broke it anyway,
one tier after applying it correctly to 1.4. Stripping `//` comments before parsing gives **37**,
and 10 of the 12 "redundant" entries become load-bearing.

Worth stating plainly: **a measuring instrument needs the same falsification as the code it
measures.** The corrected probe was checked by planting a dead entry and a redundant entry and
confirming each is reported — a step the first version never got.

### Result

| Measure                       | Before | After  |
| ----------------------------- | ------ | ------ |
| ALLOWLIST entries             | **37** | **34** |
| Dead (suppress nothing)       | 2      | 0      |
| Redundant (nothing exclusive) | 1      | 0      |
| Unsuppressed hits             | 0      | 0      |

Row 0.7 asserted **34 entries**. That number came from a loose grep in 0.6 that counted comment
lines as entries. The measured figure was 37 — and 34 is coincidentally the _surviving_ count, which
is the kind of agreement that hides a mistake rather than revealing one.

### The two dead entries were dead for different reasons, and that distinction is the finding

- `{ file: 'docs/', match: 'methodolog' }` — genuinely dead. `docs/` is scanned, and now contains
  zero hits.
- `{ file: 'CLAUDE.md', match: 'methodolog' }` — inert **because nothing reached it**. `CLAUDE.md`
  holds 3 hits. `.gitignore` lists it (while git still tracks it), and ripgrep honours `.gitignore`.

Treating both as "stale exceptions" and deleting them identically would have been wrong. The second
is a **reach gap wearing a stale exception's clothes** — the entry is correct, the scanner is not.
Both were removed (the row's criterion is suppression, and neither suppresses), but the second is
recorded as row 0.8 with a note to restore it if the scan widens.

### The guard cannot see 57 git-tracked files

Measured by set difference: `git ls-files` minus `rg --files`. Two causes — ripgrep skips dot-paths
without `--hidden`, and `.gitignore` lists `CLAUDE.md`. Four of the 57 contain the vocabulary, 11
occurrences, and **at least two are stale rather than exempt**:

| File                                         | Hits | Assessment                                                                                                                                       |
| -------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLAUDE.md`                                  | 3    | line 131 documents a `resource_manager (methodology)` resource type; the schema enum is `['prompt','gate','framework','checkpoint']` — **stale** |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | 2    | user-facing dropdown offering "Methodologies" — **likely stale**                                                                                 |
| `server/.dependency-cruiser.cjs`             | 5    | a rule referencing paths that no longer exist — see below                                                                                        |
| `.claude/rules/mcp-contracts.md`             | 1    | "methodology overlays" — plausibly live, needs a read                                                                                            |

A guard's allowlist can only ever be as honest as its reach. Every entry here is now load-bearing
**within a scan that misses 57 tracked files**, which is a weaker statement than "the allowlist is
clean" and is why 0.8 exists as a row rather than a footnote.

### This closes 1.2's open unknown, with a live instance rather than a probe

1.2 recorded: _does dependency-cruiser report a `forbidden` rule whose `to.path` matches nothing?_
It assumed not, and left the question open.

**Answer: no.** `methodology-via-loader-only` has `to.path: 'methodologies/'` — there is no such
directory anywhere in the repo — and both its `pathNot` exemptions name files under
`src/engine/frameworks/methodology/`, which does not exist either. `npm run validate:arch` passes,
reports its usual 3 warnings and 444 modules, and mentions the rule **0 times**. It has been
incapable of firing and nothing said so.

**Consequence for 1.2's own work**: the `tool-layer-no-validator-value-imports` rule it added
carries a literal six-module `to.path`. A rename of any one silently shrinks its coverage with no
signal. Its header already claimed "equal to the script on RENAME fragility, not better" — that is
now measured rather than reasoned, and the failure mode has a worked example in the same file.

### Criteria → verification (`all_criteria_mapped: yes`)

| Criterion                                    | Check                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| Every entry suppresses ≥1 hit, or is deleted | probe: 34 load-bearing, 0 dead, 0 redundant                            |
| Count recorded before and after              | 37 → 34, table above                                                   |
| The guard still passes                       | `node scripts/validate-no-methodology-vocab.js` EXIT 0, 0 unsuppressed |
| The survivors are genuinely needed           | deleting one (`framework-schema.ts`) makes the guard EXIT 1            |
| The probe can actually report a finding      | planted dead entry reported; planted redundant pair reported           |

### Measured after

`validate:all` **EXIT 0**, 30 steps · **1992 tests / 166 suites** · `lint:ratchet` 3193/1027, no
regressions · guard entries **34** (from 37) · exception entries repo-wide **37 → 34**.

### Divergences logged during execution

1. **The probe reproduced F2**, the plan's own named error, one tier after applying it correctly.
   Comment-stripping fixed it; falsifying the probe is now part of the procedure.
2. **Row 0.7's count of 34 was wrong (37)**, and wrong in a way that coincidentally matched the
   answer.
3. **"Dead entry" is two different findings** — file is clean vs scanner cannot reach file. Only the
   first is a stale exception.
4. **4.1's scope shrinks again**: 37 → 34 live entries after this tier, but its detector must also
   distinguish the two dead-entry causes above, or it will report reach gaps as stale exceptions.

## Execution record — Tier 3.1 (2026-08-06)

`validate:all` is `node scripts/run-validation-suite.js`. The 30-step `&&` string is gone; the
suite is a declared array in the runner, every step is executed, timed, and — on failure —
re-printed in one recap.

### The row asked for two failures. The demonstration produced four, which is the better evidence

Two throwaway files were planted (`scripts/__falsification-probe.js` naming the vocabulary,
`src/__falsification-probe.ts` naming `StepState`) and the real suite was run:

| Runner                    | Steps reported failing                                                               | Hidden |
| ------------------------- | ------------------------------------------------------------------------------------ | ------ |
| `run-validation-suite.js` | `lint:ratchet`, `validate:arch`, `validate:no-stepstate`, `no-methodology-vocab`     | 0      |
| the committed `&&` chain  | `lint:ratchet` only — **0 mentions** of either planted defect anywhere in its output | 3      |

Two plants tripped four checks, because an orphan `.ts` file is also an ESLint problem and a
dependency-cruiser orphan. That is the point: `lint:ratchet` is step 1, so the `&&` chain aborted
before any guard ran and reported a lint failure that explained nothing about what had been
planted. The counterfactual was measured, not reasoned — the old chain was recovered from
`git show HEAD:server/package.json` and run against the same two files.

### What the timing data settles

| Bucket          | Steps | Time   | Share |
| --------------- | ----- | ------ | ----- |
| Heavy           | 6     | 41.7 s | 90%   |
| Everything else | 24    | 4.6 s  | 10%   |

At ≈190 ms each against a measured 138 ms npm floor, the 24 light steps are **mostly process
startup and barely any work** — and they are still only a tenth of the suite. Both halves matter:
the plan's efficiency argument for re-homing checks into a pass something already makes is
directionally right about those steps, and simultaneously worth **under 5 s** in total. The runner
therefore keeps `npm run` per step rather than resolving commands out of `package.json` and
re-implementing npm's `.bin` PATH inside the process the entire gate depends on. Saving 4 s is not
worth making the gate's own runner a source of divergence.

### The suite list left package.json, and one exemption had to follow it

The vocab guard failed on the first run of the new runner — `SUITE` names
`validate:no-methodology-vocab`, and the allowlist entry covering that string was scoped to
`package.json`. The exemption was not wrong and had not gone stale; the code it described **moved**.

That is a third way an accepted exception decays, alongside the two 0.7 separated (file is clean vs
scan cannot reach file). It also argues for how 4.1's detector must be keyed: on _does this entry
still suppress a hit_, which catches all three, rather than on file identity, which catches none.
Entry added with the same retirement condition as its sibling; both retire in the same commit.

### A mutation the tests did not catch, and why

Four mutations were applied to the runner. Three reddened immediately. The fourth — truncating the
failure recap to `failures.slice(0, 1)` — **passed every assertion**. The test asserted both failing
step names appeared in the output, and they did: in the per-step lines above the recap. The
assertion was reading the whole log when the behaviour under test lived in one section of it.

Fixed by slicing the output at the recap marker and asserting there. Recorded because the shape
recurs: an assertion scoped wider than the behaviour it names will pass on output produced by a
different mechanism entirely.

| Mutation                                    | Tests reddened          |
| ------------------------------------------- | ----------------------- |
| loop breaks on first failure                | 2                       |
| recap truncated to first failure            | 0 → **1** after the fix |
| always `process.exit(0)`                    | 2                       |
| `SUITE` names a script `package.json` lacks | 1                       |

### Criteria → tests (`all_criteria_mapped: yes`)

| Criterion                                          | Test                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| A failing step does not stop the run               | `continues past a failure and still runs — and passes — the steps after it` |
| Every failure appears in the summary, not just one | `reports BOTH broken checks in one run` (recap-scoped)                      |
| Non-zero exit when any step fails                  | both failure tests assert `status === 1`                                    |
| Zero exit when all pass                            | `exits 0 and says so when every step passes`                                |
| A summary is emitted with status and duration      | `emits a summary line per step with a status and a duration`                |
| Declared steps exist in `package.json`             | `declares only steps that package.json actually defines`                    |

The last criterion guards a risk this tier **introduced**: the step list no longer lives in
`package.json`, so a name and its definition can now drift apart. The converse — a `validate:*`
script that exists and is in no suite — is still unguarded, and is row 3.3.

### Measured after

`validate:all` **EXIT 0**, 30 steps, 46.5 s · typecheck EXIT 0 · `test:ci` **1997 tests / 167
suites** (from 1992 / 166) · `lint:ratchet` and `typecheck:tests:ratchet` no regressions · vocab
guard entries **34 → 35**.

### Divergences logged during execution

1. **The plan's 38.7 s / 33 steps does not reproduce.** Measured 47.6 s over 30 steps on the `&&`
   chain immediately before the change. Fewer steps, longer run — the earlier figure is not a
   usable baseline and has been marked as such in the Inventory.
2. **`generate:contracts --check` does not write**, contradicting the open unknown that named it as
   the reason to fear parallelisation. Checked all 30 steps: one writes anything at all, and only
   gitignored caches.
3. **My own consumer search hid `.github/`** until `--hidden` was added — the 0.8 defect, reproduced
   on a different target, by hand, while investigating something unrelated.
4. **Two scripts turned up that nothing runs** — rows 3.2 and 3.3.
5. **The Inventory's chain-length probe is now vacuous** and has been re-pointed at `SUITE.length`
   rather than left to return a wrong answer confidently.

## Execution record — Tier 4.1 (2026-08-06)

`scripts/lib/exception-hygiene.js` holds one sentence: **an accepted exception must suppress at
least one finding the gate would otherwise report, exclusively, and the gate must be able to see
the thing it names.** Five verdicts are that sentence failing in five places. Every Class-B surface
now supplies a `classify` predicate and the module owns everything that must not differ between
them — the vocabulary, the `closedBy` requirement, the report, and the exit semantics.

### The scope was wrong in both directions, and one of the two is a different kind of error

|                        | Authored in the row   | Measured                    |
| ---------------------- | --------------------- | --------------------------- |
| Surfaces               | 3                     | **5**                       |
| Entries                | 46                    | **51**                      |
| Already self-detecting | 1 surface / 8 entries | **2 surfaces / 11 entries** |

The missing surface is `table-contracts.ts` — `acceptedPhantomColumns` (3) and
`acceptedForeignWriters` (2). It is the surface `.claude/rules/sqlite-persistence.md` explicitly
names as the canonical case: _"Neither gate detects a satisfied exception; `verify-mcp-surface.mjs`
does, and that is the pattern to copy."_ The plan had the finding written down in a rule file and
still sized the tier without it.

This plan has now produced a wrong count five times. Four were **miscounts of surfaces already
named** and were caught by re-measuring. This one was a **surface never named**, and re-measuring
the three known files would never have found it — that only fell out of asking the repo _what
declares a suppression?_ rather than asking the list _how long are you?_ **Re-measuring a list you
have will not find the list you forgot.**

`validate-no-llm-client.js` was the second correction: it had independently grown
`staleAllowlistEntries()`, covering subject-missing and satisfied. So "self-detects" was never
binary either — `validate-table-contracts` had the **form** half (`closedBy` non-empty) and none of
the **truth** half, and `no-llm-client` had exactly the reverse. Two gates each had half the check
and neither had both. That is row 4.3.

### Five verdicts, and the one that must not collapse into the others

| Verdict           | Means                                                             | Remedy                             |
| ----------------- | ----------------------------------------------------------------- | ---------------------------------- |
| `load-bearing`    | suppresses a real finding nothing else covers                     | keep                               |
| `satisfied`       | subject is scanned and clean                                      | delete                             |
| `subject-missing` | what it names does not exist — born dead, or outlived its subject | delete                             |
| `redundant`       | another entry covers every hit it covers                          | delete                             |
| `unreachable`     | subject exists, the scan cannot reach it                          | **do NOT delete — widen the scan** |

Three verdicts say delete and one says the opposite. A harness that folded them into "stale" would
have told the reader to remove 0.7's `CLAUDE.md` entry — an exemption covering 3 live hits in a
file `.gitignore` hides from ripgrep — and the finding would have returned the moment row 0.8 lands.
That case is now reproduced mechanically rather than by hand.

### Falsification — every gate observed failing, every verdict reached

| Gate                                | Verdicts planted                                          | Result     |
| ----------------------------------- | --------------------------------------------------------- | ---------- |
| `no-methodology-vocab`              | satisfied · subject-missing · **unreachable** · redundant | 4/4 exit 1 |
| `no-llm-client`                     | satisfied                                                 | exit 1     |
| `verify-mcp-surface`                | subject-missing                                           | exit 1     |
| `table-contracts` (foreign writers) | satisfied · unreachable · subject-missing                 | 3/3 exit 1 |
| `no-phantom-columns`                | satisfied · subject-missing                               | 2/2 exit 1 |

**Two of those plants first produced the wrong verdict, and the plants were what was wrong.** A
foreign writer planted as `hooks/lib/chain_state.py` reported `subject-missing` rather than
`unreachable` because that file does not exist; a phantom column planted as `kv_state.value`
reported `subject-missing` because the column is called `state`. Both looked like a passing
falsification — the gate did go red — while proving a different branch than the one intended.
**"The mutation fired" is not "the branch I meant fired."** Fixed by reading the actual DDL and the
actual `hooks/lib/` listing, then re-planting.

### Criteria → tests (`all_criteria_mapped: yes`)

| Criterion                                                           | Test                                                                 |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| A load-bearing entry is not reported                                | `reports nothing for a load-bearing entry`                           |
| satisfied / subject-missing / redundant are reported and say delete | `reports %s and tells the reader to delete` (3 cases)                |
| unreachable is reported and does NOT say delete                     | `reports unreachable as a problem whose remedy is NOT deletion`      |
| The classifier's detail reaches the reader                          | `carries the classifier detail into the message`                     |
| An empty `closedBy` is a finding independent of truth               | `reports a missing closedBy even when the entry is load-bearing`     |
| A shape with no `closedBy` is not penalised for lacking one         | `skips the closedBy check entirely for shapes that do not carry one` |
| A gate can fold the audit into its own exit code                    | 2 `reportExceptionAudit` return-value tests                          |
| Each gate fails on a planted satisfied exception                    | 5 gates × mutation, table above                                      |

### Measured after

`validate:all` **EXIT 0**, 30 steps, 42.8 s · typecheck EXIT 0 · `test:ci` **2007 tests / 168
suites** (from 1997 / 167) · `lint:ratchet` 3193/1027 no regressions · `typecheck:tests:ratchet` 385
no regressions · build EXIT 0 · **live `verify:mcp` 12/12** against the fresh build · exception
entries **51 across 5 surfaces, all load-bearing, all now audited on every run**.

### Divergences logged during execution

1. **A fifth exception surface existed** and the row never named it — see above.
2. **`no-llm-client` already had a stale-entry detector**, so the row's "only `verify-mcp-surface`
   self-detects" was wrong. Re-homed onto the shared definition rather than left as a second one.
3. **Two falsification plants proved the wrong branch** before the inputs were corrected.
4. **`table-contracts` reported "5 accepted foreign writer(s)" for 2 declared exceptions** covering
   5 write sites. Reworded to say sites and entries separately — a count that reads as one thing and
   means another is how this plan's numbers went wrong five times.
5. **The vocab guard's entries have no structural `closedBy`**, so its form check is off. Row 4.2.
6. **`scripts/lib/` is a new directory.** `exception-hygiene.js` is `.js`, not `.ts`, because it is
   imported both by `node`-run guards and by `tsx`-run validators; the Jest suite reads it through a
   hand-written `.d.ts`, the same arrangement `eslint-rules/claude-plugin.d.ts` already uses.

7. **`table-contracts-reader.ts` gained `sqlScanFileSet()`.** Reachability had to be answered as "is this path one the SQL scan actually reads", and the only honest source for that is the walk the scan itself uses. Restating the rule (`src/**/*.ts` minus `_generated`, `.d.ts` and the exempt file) in the validator would have been a second copy free to drift — and a drifted reachability rule reports blind spots as cleanliness, which is the failure this tier exists to prevent. Exported from the reader that owns the walk instead.
8. **The Inventory's `ls scripts/ | wc -l` probe stopped meaning one thing**, because `scripts/lib/` is a directory and the probe counts it as a script. Corrected in place along with the count. Third probe in this plan to be invalidated by the work rather than by drift — after 1.5's regexes and 3.1's `split(' && ')`.
