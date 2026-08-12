---
title: "Shim & Compat-Alias Debt Sweep — implementation notes"
date: 2026-08-11
status: reference
tags: []
---

# Shim-debt sweep — implementation notes (tier 5.7 retirement)

Deviation log for the 5.7 execution. The plan file is the state machine; this is the record of
what diverged while executing it.

## Deviations

| #   | Deviation                                                                                                                                                                                                                                                                     | Evidence                                                                                                           | Resolution                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **5.7 names 2 folds; 19 allowlist entries carried its retirement condition.** The row's Files column covers families A and B only. `RETIREMENT.RENAME_MAJOR` was also shared by the 5.1 placeholder, the 5.2 config key, the 5.3 authoring payload and the 5.6 criteria value | `rg "RETIREMENT.RENAME_MAJOR"` → 19 entries across 6 fold families                                                 | Operator ruled **full unit**. All 6 retired together, matching the guard's own "all retire together" comment                        |
| 2   | **The retirement condition was met 10 days before execution and nothing said so.** v3.0.0 was tagged 2026-07-31, one day after the rename landed, shipping `frameworkGates` in all 8 framework YAMLs. Two further releases followed. The row still read ⊘ DEFERRED            | `git log -1 --format=%ci v3.0.0`; `git grep -c frameworkGates v3.0.0 -- server/resources/frameworks` → all 8       | Retired. **A retirement condition with no detector is still permanent** — nothing in the repo watches for one coming true           |
| 3   | **Semver conflict, raised and overridden.** Retiring A/B/C/E removes accepted input spellings from in-contract formats. Family D alone is undeclared and therefore safely non-breaking                                                                                        | `rg "methodology_gates" tooling/ src/mcp/contracts/` → 0, sensitivity-checked (same probe finds `framework_gates`) | Owner chose to ship in a **minor**, not v4. Recorded as Breaking in CHANGELOG rather than laundered as non-breaking                 |
| 4   | **My site inventory was incomplete — `head` truncated it.** Two further `methodology_gates` fallbacks in `framework_builder/script.py` (343, 516) were outside the first probe's output                                                                                       | `validate:no-methodology-vocab` caught both after the first edit pass                                              | Fixed. The guard, not the plan or my inventory, closed the gap — the argument for writing the guard before the cleanup              |
| 5   | **A negative-verification probe was vacuous and read as green.** The family-C mutation failed its anchor assert, and the test run still printed `2124 passed` — which reads as "mutation survived" but meant "mutation never applied". Prettier had reflowed the anchor       | `AssertionError: anchor not found` immediately above `Tests: 2124 passed`                                          | Re-run against the real text; 1 test then failed. **Third vacuous probe in this plan's history** — check non-empty before believing |
| 6   | **The exception-hygiene gate cannot see untracked files.** A correct new allowlist entry reported `subject-missing` because the test file it names was not yet tracked and the scan reads `git ls-files`                                                                      | `git add -N` on the new test → entry resolves, guard green                                                         | Not a defect but a real ordering constraint: allowlist entries for new files fail until the file is tracked                         |
| 7   | **The guard was RED at HEAD, unrelated to this row.** 7 non-allowlisted hits, all self-referential. Caused by row 0.8 widening the scan to the git-tracked set — the gate began seeing its own test file and `.d.ts`                                                          | All 3 files clean in the tree; `git show HEAD:<file> \| rg -c methodolog` → 5/1/1                                  | Fixed here with `GUARD_DELETED` entries. **Widening a gate's reach re-scopes what counts as a violation**                           |
| 8   | **One allowlist entry's retirement condition was mis-stated.** `framework-compliance/gate.yaml` was closed by `FOLD_DOCUMENTED`; re-read, its comment records a dropped `keyword_count` entry, not a fold                                                                     | The folds are now gone and the note is unaffected                                                                  | Repointed to `NOTE_USEFUL`. A mis-stated condition surfaces by coming due for the wrong reason                                      |

## Execution record

**Scope executed**: all 6 fold families — A framework YAML `methodologyGates`, B gate YAML
`methodology` + `methodology_compliance`, C `gates.methodologyGates` plus the two legacy config
sections, D `methodology_gates`/`methodology_elements` authoring payload, E `{METHODOLOGY}`
placeholder — their 19 allowlist entries, and the 3 test entries that pinned them.

**Files**: 15 source + 2 schemas + 1 Python scorer; 1 file deleted
(`framework-authoring-keys.ts`) with its test; 4 test files converted from fold-pinning to
retirement-asserting.

**Tests are inverted, not deleted.** Every fold test now asserts the old spelling is INERT.
`.passthrough()` keeps an unknown key on the parsed object, so "the fold is gone" and "the fold
silently still runs" are externally identical — only an assertion on the resulting value separates
them. Deleting the tests would have removed the only evidence the retirement took effect.

**Negative verification** (distinct mutations must fail distinct tests):

| Fold reinstated                      | Result                               |
| ------------------------------------ | ------------------------------------ |
| `FrameworkSchema` `.transform()` (A) | **1 failed** / 2123 passed — its own |
| `ConfigLoader` gates read (C)        | **1 failed** / 2123 passed — its own |

**Gate**: `validate:all` 34 of 34 PASS. `validate:no-methodology-vocab` green at **19 accepted
exceptions, down from 42**, all load-bearing. typecheck 0, `typecheck:tests:ratchet` PASS,
`lint:ratchet` PASS (no regressions), `validate:arch` PASS, unit **2124/2124**. The single failure
was Prettier on this notes file.

## Validation runs

- 2026-08-11 21:10 · `npm run validate:all 2>&1 | tail -45` · ran
- 2026-08-11 21:09 · `cp /tmp/cfg.bak src/infra/config/index.ts && rg -c "methodologyGates" src/infra/config/index.ts >/dev/null && echo "REST` · ran
- 2026-08-11 21:08 · `python3 - <<'EOF' p='src/infra/config/index.ts' s=open(p).read() old=" enableFrameworkGates: gatesConfig.frameworkGates ` · ran
- 2026-08-11 21:07 · `cp src/infra/config/index.ts /tmp/cfg.bak && python3 - <<'EOF' p='src/infra/config/index.ts' s=open(p).read() old=""" en` · ran
- 2026-08-11 21:06 · `cp src/engine/frameworks/definitions/framework-schema.ts /tmp/claude-1000/fs.bak 2>/dev/null || cp src/engine/frameworks` · ran
- 2026-08-11 21:04 · `cd /home/minipuft/Applications/claude-prompts-mcp && git add -N server/tests/unit/gates/pass-criteria-framework-vocab.te` · ran
- 2026-08-11 21:04 · `npm run test:unit -- --testPathPatterns="(pass-criteria-framework-vocab|framework-gates-field|legacy-key-migration|templ` · ran
- 2026-08-11 21:03 · `npm run validate:no-methodology-vocab 2>&1 | tail -15` · ran
- 2026-08-11 21:02 · `npx jest tests/unit/gates/pass-criteria-framework-vocab.test.ts tests/unit/frameworks/framework-gates-field.test.ts test` · ran
- 2026-08-11 21:02 · `npm run validate:no-methodology-vocab 2>&1 | tail -20` · ran
- 2026-08-11 21:02 · `npm run typecheck 2>&1 | tail -25` · ran
