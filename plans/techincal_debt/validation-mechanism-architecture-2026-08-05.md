---
title: "Validation Mechanism Architecture — right tool per check class"
date: 2026-08-05
status: backlog
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

Nine `validate-no-*` guards hand-roll file walking and regex over source files. ESLint already
parses every one of those files, has the AST, gives editor feedback, supports `--fix`, and feeds a
ratchet this repo already trusts. `server/eslint-rules/claude-plugin.js` **already exports four
working custom rules** (`no-context-deep-imports`, `no-legacy-imports`, `require-file-lifecycle`,
`no-emojis`) and is wired at `eslint.config.mjs:12`. The better standard is not hypothetical here —
it is already half-adopted, and the guards are the half that did not move.

## Inventory (measured 2026-08-05 — re-measure before executing)

| Fact                                             | Probe                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| 39 scripts under `server/scripts/`               | `ls scripts/ \| wc -l`                                                |
| `validate:all` is a 49-step `&&` chain           | parsed from `package.json`                                            |
| 17 of those 49 steps are `:self-test`            | same parse                                                            |
| 4 custom ESLint rules already shipping           | `eslint-rules/claude-plugin.js:469`                                   |
| **Only 4 of 8** candidate guards are source-only | `rg -q 'existsSync\|readdirSync.*resources\|\.yaml\|\.json'` per file |

### Correction to the originating claim

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
| **A — source pattern** | bans a construct in TS source    | **ESLint rule**    | `no-stepstate`, `no-crosslayer-reexport`                                                                                                                                  |
| **B — cross-artifact** | compares two artifacts           | **stays a script** | `validate-table-contracts` (TS module vs embedded DDL), `validate-package-entries` (package.json vs filesystem), `verify-mcp-surface` (registered actions vs live server) |
| **C — self-test**      | asserts the checker itself works | **Jest**           | the 17 `:self-test` steps                                                                                                                                                 |

Class B is the honest defense of scripts: ESLint is scoped to one file and structurally cannot
compare a TypeScript module against a SQL string, or a manifest against a tarball. Those are not
lint problems and should not be forced into a linter.

## Subtiers

| #   | Status | Step                                                                                                                                                          | Depends | Verification                                                                                           |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| 1.1 | ☐      | Prove the pattern on ONE guard: port `no-stepstate` (64 ln, source-only, migration already complete so it is pure regression-guard) to a `claude-plugin` rule | —       | Rule fires on a reintroduced `StepState` identifier; script deleted; `validate:all` step count 49 → 48 |
| 1.2 | ☐      | Port the remaining three source-only guards                                                                                                                   | 1.1     | Each: rule fires on a planted violation before the script is deleted                                   |
| 1.3 | ☐      | Per-script judgment on the four mixed guards — split AST half from artifact half, or leave whole. **Decide, do not sweep**                                    | 1.2     | A written verdict per script naming why it moved or stayed                                             |
| 2.1 | ☐      | Move the 17 `:self-test` entries into Jest                                                                                                                    | —       | `validate:all` step count drops by 17; the same assertions run under `npm test` with coverage          |
| 3.1 | ☐      | Replace the `&&` chain with a runner that executes all steps and reports a summary                                                                            | 2.1     | Two deliberately broken checks are BOTH reported in one run, not just the first                        |
| 4.1 | ☐      | Shared exception-hygiene harness for Class B: one definition of "an accepted exception must still be true"                                                    | —       | A satisfied exception is reported as stale by every Class-B gate, not just `verify-mcp-surface`        |

**Gate**: `npm run validate:all` passes, `npm test` passes, and every ported rule has been observed
failing on a planted violation before its script was deleted.

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
