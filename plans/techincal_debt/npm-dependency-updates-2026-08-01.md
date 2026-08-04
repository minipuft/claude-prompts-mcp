---
title: "npm Dependency Updates — 4 Tiers"
date: 2026-08-01
status: done
tags: []
---

# npm Dependency Updates — 4 Tiers

**Date**: 2026-08-01
**Baseline**: v3.0.1 (`afd1c0ac`)
**Work type**: refactor (dependency maintenance)
**Confidence**: high for Tiers A, B, D · medium for Tier C

---

## Summary

Sixteen npm packages are behind. GitHub Actions are **not** in scope — checkout v7, setup-node v7,
github-script v9, release-please v5 and action-gh-release v3 all landed on 2026-08-01.

Four tiers, ordered by how expensive the verification is, not by how large the diff is.

**The finding that shapes this plan**: `@modelcontextprotocol/sdk@1.30.0` uses **two different
JSON Schema converters** depending on which zod major it detects. Upgrading zod swaps the engine
that produces our published MCP tool surface. That makes Tier C a contract question, not a
dependency bump — and it is the reason Tier C is last and its version strategy is deliberately
undecided.

---

## Findings the plan rests on (each probe-verified)

| #   | Finding                                             | Probe                                               | Result                                                                                |
| --- | --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | SDK swaps converters between zod 3 and zod 4        | `rg -n` on `zod-json-schema-compat.js`              | CONFIRMED :19-28 — `isZ4Schema()` → `z4mini.toJSONSchema()`, else `zodToJsonSchema()` |
| 2   | js-yaml 5 removes two APIs we use                   | CHANGELOG 5.0.0 "### Removed"                       | CONFIRMED — `DEFAULT_SCHEMA` and loader option `onWarning`                            |
| 3   | Our js-yaml exposure is 5 sites, not 2              | `rg -n "DEFAULT_SCHEMA\|onWarning" yaml-parser.ts`  | CONFIRMED :17, :22, :82, :84, :86 — :22 is an **exported** type member                |
| 4   | diff v9 ships its own types                         | `npm pack diff@9.0.0`                               | CONFIRMED — `types: libcjs/index.d.ts`; all 3 used functions present                  |
| 5   | No YAML merge keys anywhere                         | `rg -l '^\s*<<\s*:' --glob '*.yaml' --glob '*.yml'` | 0 files — js-yaml 5's `!!merge`-by-default removal is discharged                      |
| 6   | No empty YAML resources                             | `fd -e yaml -e yml resources/` + size test          | 0 of 74 — v5's "`load()` throws on empty" is discharged                               |
| 7   | `zod-to-json-schema` never touches the tool surface | `rg -n "zodToJsonSchema" src/ scripts/ tooling/`    | 3 sites, all in `scripts/generate-framework-schemas.ts`                               |
| 8   | No collision with concurrent pipeline work          | `rg -l "from 'zod'\|from 'js-yaml'" \| rg pipeline` | none — file sets are disjoint                                                         |
| 9   | `tests/contract/` does not exist                    | `ls -d server/tests/contract`                       | ENOENT — fixture must live in `tests/integration/`                                    |
| 10  | express hold still on `main`                        | `rg -n` + `gh pr view 170`                          | `renovate.json5:145` alive; **PR #170 OPEN**                                          |

---

## Tier A — tooling (dev-only)

One PR, `chore(deps)`. Nothing ships to users.

| #   | Status | File                  | Change                                                              | ~Lines | Depends | Verify                                                                                        |
| --- | ------ | --------------------- | ------------------------------------------------------------------- | ------ | ------- | --------------------------------------------------------------------------------------------- |
| A1  | ✓      | `package.json` (root) | `@commitlint/cli` + `config-conventional` ^20.4.0 → ^21.2.1/^21.2.0 | 2      | —       | commit with a valid scope and an invalid one; the invalid must be **rejected**                |
| A2  | ✓      | `server/package.json` | `lint-staged` ^16.3.3 → ^17.3.0                                     | 1      | —       | stage a badly formatted file; the malformed form must not survive into the commit             |
| A3  | ✓      | `server/package.json` | `dependency-cruiser` ^17.3.6 → ^18.1.0                              | 1      | —       | `npm run validate:arch` exit 0 **and** a deliberately added cross-layer import still fails it |
| A4  | ✓      | `server/package.json` | `knip` ^5.86.0 → ^6.31.0                                            | 1      | —       | `npx knip` output diffed against the pre-bump run                                             |

**Gate**: `npm run validate:all` exit 0 · `lint:ratchet` no regressions. — **PASSED**

> A1-A3 each verify by **forcing a failure**, not by observing a pass. A4 cannot fail CI — knip is
> ad hoc — so its verification is an explicit output comparison. Without that, the bump is
> unverified rather than verified.

### Two plan drifts corrected during execution

The declared ranges differed from the resolved versions this plan was written against, and two
rows named the wrong file or the wrong observable:

| Row | Plan said                                         | Actually                                                      | Consequence                                                                                                        |
| --- | ------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A2  | `lint-staged` in `package.json` (root)            | `server/package.json` — root declares only commitlint + husky | Editing the root file would have bumped nothing; `.husky/pre-commit:60` runs `npm --prefix server run lint:staged` |
| A2  | pre-commit must **reject** a badly formatted file | the config is `prettier --write` — it **fixes** and re-stages | "must reject" could never be observed; the real observable is that the malformed form does not reach the commit    |

### Verification evidence

| #   | Probe                                                                                         | Result                                                                       |
| --- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A1  | `echo "chore(deps): update tooling" \| npx commitlint`                                        | exit 0 — accepted                                                            |
| A1  | `echo "chore(bogusscope): ..." \| npx commitlint`                                             | exit 1 — `scope-enum` rejected                                               |
| A1  | `echo "frobnicate: something" \| npx commitlint`                                              | exit 1 — `type-enum` rejected                                                |
| A2  | staged `export const   probe    =  {a:1,   b:2};` + 2 blank lines                             | rewritten to `export const probe = { a: 1, b: 2 };` and re-staged; exit 0    |
| A3  | `validate:arch` on clean tree                                                                 | exit 0 — 2 pre-existing warnings, 0 errors                                   |
| A3  | added `src/shared/__arch_probe.ts` importing `mcp/tools/prompt-engine` (L0 → L4 value import) | exit 1 — `error shared-no-cross-layer-value`. Probe deleted; exit 0 restored |
| A4  | `npx knip --reporter compact` before vs after                                                 | see below                                                                    |

**A4 — the knip 6 diff is substantive, so it is enumerated rather than summarised:**

| Section                | knip 5.86                     | knip 6.31 | Reading                                          |
| ---------------------- | ----------------------------- | --------- | ------------------------------------------------ |
| Unused files           | 22                            | 22        | identical                                        |
| Unused dependencies    | 1 (`ajv`)                     | 1         | identical                                        |
| Unused devDependencies | 1 (`@types/diff`, `ts-morph`) | 1         | identical — independently corroborates finding 4 |
| Unlisted dependencies  | 164                           | 164       | identical                                        |
| Unlisted binaries      | 1                             | **9**     | **gained 8 real detections**                     |
| Unresolved imports     | 3                             | 3         | identical                                        |
| Unused exports         | 119                           | 116       | −3                                               |
| Unused exported types  | 187                           | **124**   | **−63**                                          |
| Duplicate exports      | 1                             | 1         | identical                                        |

Every dependency-level section is byte-identical — the categories this tier could plausibly have
broken did not move. The 8 new unlisted binaries are genuine: `scripts/validate-no-*.js` shell out
to `rg` via `execSync`, and `ripgrep` is declared nowhere, so those guards silently depend on an
external binary. Pre-existing and out of scope here; worth its own item.

The −63 on unused exported types is a semantics change, not a lost signal in a gate — spot-checked
in both directions. `FrameworkManagerConfig` dropped out of the report despite having zero
consumers outside `framework-manager.ts`; `ValidationError` (`engine/execution/types.ts:244`)
entered it, and is indeed referenced only inside its own file at :271. knip 6 treats same-file
usage differently. Since `lint:unused` is ad hoc and **not** a member of `validate:all`, no gate
changed behaviour either way.

**Not introduced by this tier**: `npm audit` reports 25 vulnerabilities (21 moderate, 4 high), all
`protobufjs` transitives under `@opentelemetry/*`. Verified identical on `main` via
`git stash && npm ci && npm audit`, so this is a pre-existing item, not a Tier A regression.

**Gate results**: `typecheck` exit 0 · `lint:ratchet` 3475 errors / 1434 warnings, no regressions ·
`validate:all` exit 0 (all 23 members, self-tests included) · `test:ci` 146 suites / 1732 tests green.

---

## Tier B — runtime deps

One PR, **two separate commits** so a bisect can attribute a failure.

### B-1: js-yaml 4.3.1 → 5.2.3

`js-yaml` 5 is a TypeScript rewrite with a reorganised public API.

| #   | Status | File                                                               | Change                                                                           | ~Lines | Depends     | Verify                                          |
| --- | ------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------ | ----------- | ----------------------------------------------- |
| B1  | ✓      | `server/package.json`                                              | `js-yaml` → ^5.2.3; **`@types/js-yaml` removed** — v5 self-types                 | 2      | —           | `npm ci` clean                                  |
| B2  | ✓      | `server/src/shared/utils/yaml/yaml-parser.ts`                      | drop `yaml.DEFAULT_SCHEMA`; v5 `load` defaults to `CORE_SCHEMA`                  | ~3     | B1          | `npm run typecheck`                             |
| B3  | ✓      | `server/src/shared/utils/yaml/yaml-parser.ts`                      | remove `onWarning` from `YamlParseOptions` and `warnings` from `YamlParseResult` | ~40    | B2          | `npm run typecheck`                             |
| B3b | ✓      | 14 files across `src/`, `scripts/`, `tests/`                       | `import yaml from 'js-yaml'` → `import * as yaml from 'js-yaml'`                 | 14     | B1          | **`npm run build`** — typecheck cannot see this |
| B4  | ✓      | `server/tests/integration/resources/yaml-corpus.test.ts` **(new)** | load every git-tracked YAML resource; assert each parses non-empty               | ~85    | B2, B3, B3b | fails if any resource stops parsing             |

#### B3 resolved: the option and the field were dead surface

The plan left this open pending `rg -n "\.warnings" server/src/`. Probed across `src/`, `scripts/`
and `tests/`: **no caller passes `onWarning`, and no caller reads `YamlParseResult.warnings`.**
Every `.warnings` hit belongs to an unrelated type (validation results, diagnostics). So the
removal propagates rather than being preserved — nothing consumed it.

`allowDuplicateKeys` was removed in the same edit. It was declared on `YamlParseOptions` but never
forwarded to `yaml.load`, so setting it had no effect in any version — a knob that has always been
a no-op, not a v5 casualty.

#### B3b — the scope error this tier turned up

The plan said the wrapper was "the single chokepoint all 7 importers pass through." **It is not.**
`rg -n "from 'js-yaml'"` finds **15** direct importers; the wrapper is one of them. Fourteen used
`import yaml from 'js-yaml'`, and **js-yaml 5 publishes no default export**:

```
SyntaxError: The requested module 'js-yaml' does not provide an export named 'default'
```

**The plan's stated verification for B2 and B3 — `npm run typecheck` — cannot detect this.** With
`esModuleInterop` and `allowSyntheticDefaultImports` both `true` (`tsconfig.json:8-9`), TypeScript
accepts a default import that Node rejects at module instantiation. Measured: after bumping to
js-yaml 5 and before any source edit, `tsc --noEmit` reported **4 errors, all inside
`yaml-parser.ts`, and zero for the 14 files that crash on import.**

What does catch it is `npm run build` — esbuild fails with
`No matching export in "js-yaml.mjs" for import "default"`. The unbundled `scripts/*.js` have no
bundler in front of them and fail at runtime; confirmed by importing
`scripts/generate-gate-index.js`, which threw the SyntaxError above before the fix and runs clean
after.

The fix is the namespace form, verified through both consumption paths _before_ being applied
(`import * as yaml` bundles under esbuild and resolves under plain Node). That keeps every
`yaml.load` / `yaml.dump` call site untouched — 1 line per file instead of rewriting ~60 member
accesses.

### B-2: diff 8.0.4 → 9.0.0 + retire @types/diff

| #   | Status | File                                                                               | Change                                     | ~Lines | Depends | Verify                                              |
| --- | ------ | ---------------------------------------------------------------------------------- | ------------------------------------------ | ------ | ------- | --------------------------------------------------- |
| B5  | ✓      | `server/package.json`                                                              | `diff` → ^9.0.0; **`@types/diff` removed** | 2      | —       | `npm run typecheck` — proves v9's own types resolve |
| B6  | ✓      | `server/src/modules/skills-sync/service.ts:17`                                     | confirm `createTwoFilesPatch` signature    | 0      | B5      | typecheck                                           |
| B7  | ✓      | `server/src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.ts:3` | confirm `createPatch`, `structuredPatch`   | 0      | B5      | patch generation exercised end-to-end               |

B6 and B7 needed **no code change**. Verified by executing all three functions against diff@9.0.0
rather than by reading release notes: `createPatch` emits an `@@` hunk header, `structuredPatch`
returns hunks whose shape is still `oldStart, oldLines, newStart, newLines, lines`, and
`createTwoFilesPatch` returns a non-empty patch. Identical input yields **0** hunks, which is what
proves the probe distinguishes "no change" from "cannot see the change".

`@types/diff` retirement independently corroborated: it was listed under knip's _Unused
devDependencies_ before the change and is absent after, leaving only `ts-morph`.

**Gate**: `npm run validate:all` exit 0 · `test:ci` 146 suites green · `verify:mcp` passes. — **PASSED**

**Residual risk (accepted, documented)**: findings 5 and 6 discharge the merge-key and empty-file
hazards for _bundled_ resources. Workspace overlays are user-supplied and cannot be probed from
here — noted in `CHANGELOG.md` under Changed.

### Tier B verification evidence

| Check                                                                     | Result                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `npm run typecheck`                                                       | exit 0                                                                   |
| `npm run build`                                                           | exit 0 — the gate that actually sees the default-import break            |
| `npm run lint:ratchet`                                                    | 3474 errors / 1434 warnings — one **fewer** error than the 3475 baseline |
| `npm run validate:all`                                                    | exit 0 (all 23 members)                                                  |
| `npm run test:ci`                                                         | 146 suites / 1732 tests green                                            |
| `npm run test:integration`                                                | 33 suites / 426 tests green (was 351 — +75 from B4)                      |
| `npm run test:e2e`                                                        | 3 suites / 36 passed, 2 skipped                                          |
| `npm run verify:mcp`                                                      | 11/11 checks — all 3 tools answer                                        |
| `scripts/generate-gate-index.js`, `scripts/validate-required-contexts.js` | import and run clean (both threw `SyntaxError` pre-fix)                  |

**B4 proven falsifiable**, not merely green. Two probe resources were injected in turn and each
failed the suite before being removed:

| Injected                      | Reported                                                       |
| ----------------------------- | -------------------------------------------------------------- |
| malformed YAML (`b: {broken`) | `failed to parse: deficient indentation ... (2:1)`             |
| an empty file                 | `failed to parse: expected a document, but the input is empty` |

The empty-file case is the one that matters: it is js-yaml 5's new behaviour, so B4 demonstrably
guards the exact hazard finding 6 discharged for today's corpus.

**A corpus bug B4 caught in its own first draft.** The initial version walked `resources/` with
`readdirSync` and collected **175** files; `git ls-files` reports **74**. The other 101 are
untracked personal prompts admitted by `resources/prompts/.gitignore` (which ignores `*` with
targeted un-ignores). A filesystem walk would test a different corpus on every machine, and a
local-only failure would look like a CI-passing regression. The test now enumerates git-tracked
files and asserts a floor of 50, so a broken glob fails instead of silently passing on an empty set.

## Tier C — zod 3 → 4 — gate PASSED

PR #170 merged and the rebase did **not** reinstate the express hold. All nine subtiers are
done, with two scope corrections recorded below.

| #   | Status | Step                                     | Result                                                                        |
| --- | ------ | ---------------------------------------- | ----------------------------------------------------------------------------- |
| C1  | ✓      | capture the zod-3 `inputSchema` baseline | `scripts/capture-tool-schemas.mjs` + `tests/snapshots/mcp-input-schemas.json` |
| C2  | ✓      | `zod` → ^4.4.3                           | installed                                                                     |
| C3  | ✓      | migrate the non-MCP importers            | 69 typecheck errors → 0                                                       |
| C4  | ✓      | migrate the 3 MCP schema files           | included above                                                                |
| C5  | ✓      | `zodToJsonSchema()` → `z.toJSONSchema()` | `generate-framework-schemas.ts`                                               |
| C6  | ✓      | drop `zod-to-json-schema`                | **from our dependencies only** — see below                                    |
| C7  | ✓      | diff the published surface               | **39 changes → major**                                                        |
| C8  | ✓      | remove the zod hold                      | `renovate.json5` now has no `allowedVersions` pins at all                     |
| C9  | ✓      | version decision                         | **4.0.0**, per C7                                                             |

### The migration, by pattern

| zod 3                                     | zod 4                                   | Sites                                                                                     |
| ----------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `z.record(V)`                             | `z.record(z.string(), V)`               | 24 — the single argument is now the **key** type, so a bare call silently changes meaning |
| `errorMap: (issue, ctx) => ({ message })` | `error: (issue) => string \| undefined` | 8 — `ctx.defaultError` becomes `return undefined`                                         |
| `invalid_type_error: M`                   | `error: M`                              | 5                                                                                         |
| `z.ZodIssueCode.invalid_enum_value`       | `'invalid_value'`                       | 2                                                                                         |
| `ZodError.errors`                         | `ZodError.issues`                       | 2                                                                                         |

### Two blockers typecheck could not see

**1. The published server bundle crashed on import.**

```
TypeError: Class2 is not a constructor
    at _custom (dist/index.js:11460)
    at dist/index.js:288044   <- SDK types.js: AssertObjectSchema = custom(...)
```

Not duplicate zod copies — one copy of each module is bundled and the SDK imports cleanly
**unbundled**. It is an esbuild init-order fault: our source imported `zod` (root), the SDK
imports `zod/v4`, and those are different files. Pulling in the root re-export made esbuild wrap
zod's modules in a lazy `__esm` initialiser, so `ZodCustom` (assigned at line 14748, inside it)
was still `undefined` when the SDK's top-level `custom()` ran at 288044.

Fixed by importing `zod/v4` in all 16 source files, matching the SDK. An esbuild `alias` was tried
first and rejected: aliases are prefix-based, so `zod -> zod/v4` also rewrites `zod/v3` and
`zod/v4-mini` into paths the package does not export.

**2. The `cpm` CLI bundle doubled and broke its budget.**

```
415.6 KB (zod 3)  ->  842.4 KB (zod 4)   budget 500 KB
```

**279 KB of that was locales.** `zod/v4/classic/external.js` ends with
`export * as locales from "../locales/index.js"`, and a namespace re-export is opaque to tree
shaking, so all 53 translations ship. `cli/build/zod-locales-trim.mjs` replaces that barrel with a
stub exporting `en` alone. The default locale is unaffected — it arrives through a separate direct
import two lines earlier (`import en from "../locales/en.js"; config(en())`), which the plugin
never intercepts.

That left 565 KB, still over. Rather than raise the ceiling, `prepublishOnly` now runs `build:prod`:

| Artifact                                           | Size         |
| -------------------------------------------------- | ------------ |
| published today (zod 3, unminified)                | 415.6 KB     |
| zod 4 + locale trim, unminified                    | 565.4 KB     |
| **zod 4 + locale trim, minified — what now ships** | **294.9 KB** |

The published CLI ends up **29% smaller than before this tier**, despite the larger dependency.

Two budgets exist now because two artifacts do: 500 KB minified (shipped) and 625 KB unminified
(CI, pre-push, local). Both are enforced, and the minify flag is threaded through both call sites —
`server/esbuild.config.mjs` was passing none, which silently graded the published bundle against
the looser ceiling. Skipping the check when unminified was rejected outright: CI runs exactly that
path, so it would have been a check that cannot fail. Verified against four synthetic sizes,
accepting and rejecting on both sides of both budgets.

### C7 — the diff that decided the version

**39 changes: 26 additions, 9 removals, 4 rewordings.** Non-empty, so **4.0.0**.

| Group                      | Change                                                                                                           | Reading                                                                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Strictness dropped** (3) | `additionalProperties: false` removed from `prompt_engine`, `system_control`, `resource_manager.arguments.items` | The contract change. The schema no longer advertises that unknown keys are rejected. Runtime parsing is unchanged; the published document is not. **Deliberately not restored** with `z.strictObject()` — owner's call, 2026-08-01 |
| `$ref` inlined (7)         | `chain_step_data.properties.*` pointed into `chain_steps/items`; zod 4 expands them                              | Equivalent semantically, different document for any client resolving `$ref`                                                                                                                                                        |
| Additive precision (26)    | `propertyNames: {type: "string"}` per record; safe-integer `maximum` per integer                                 | Harmless                                                                                                                                                                                                                           |

Rewordings are `additionalProperties: true` → `{}` on `.passthrough()` objects — same statement,
zod 4's spelling.

Outside the schema: zod 4 reworded its type errors. `"Expected string, received null"` became
`"Invalid input: expected string, received null"`, and that text reaches clients through the thrown
validation message. One unit test asserted the old wording; updated.

### A defect found in the diff tool itself

The first C7 run reported `additionalProperties: true` as **deleted** on three passthrough objects.
It was not — zod 4 writes `{}`, and `flatten()` walked an empty object and emitted no leaf, so `{}`
vanished and read as a removal. That would have inflated a wording change into a semantic one, on
the one output this tier exists to produce. Fixed before the diff was used to decide anything.

### The snapshot is now enforced, not decorative

`npm run validate:tool-schemas` runs in CI's Build job, after the build it depends on — not in
`validate:all`, which runs before the build and could not spawn the server. Without a wired check
the snapshot would have been a file nobody reads, which is precisely what the retired renovate
hold claims replaced it.

### C6 correction

`zod-to-json-schema` is removed **from our dependencies**, not from the tree. The SDK imports it
directly for its own zod-3 path, so it stays hoisted as a transitive. The plan's "0 hits" check
holds for `src/`, `scripts/` and `tooling/`; the stronger reading — gone entirely — is not
achievable and was not attempted.

### C5 note

`generate-framework-schemas.ts` now uses `z.toJSONSchema({ target: 'draft-7', io: 'input' })`.
Both emitted files changed shape — the old converter wrapped everything under
`definitions.<Name>` behind a root `$ref`, zod 4 emits at the root — but **no leaf value changed**
(+70/−74/~0 and +72/−73/~0). Nothing references `#/definitions/...`; these are YAML-authoring
schemas whose consumers point at the file root.

## Tier D — four sub-tiers, three executable and one blocked

Planned 2026-08-01 via `>>implementation_plan`, then **substantially corrected** by a
high-effort research agent that ran the migrations in a scratch copy. The corrections are
recorded below rather than silently folded in, because two of them invalidate claims this
plan made confidently.

### Corrections to the first pass

| I claimed                                       | Actually                                                           | Consequence                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| "TypeScript went 5.9 → 7.0 with no 6.x"         | **TypeScript 6.0.3 exists** and is verified green on this codebase | The whole tier was mis-shaped. TS 6 is a shippable step, not a gap to jump                           |
| The import→import-x swap keeps counts unchanged | The swap **renames every rule ID** `import/*` → `import-x/*`       | The ratchet reads a rename as "7 fixed + N new". Needs a key-rename strategy, not a count comparison |
| TS 7 is blocked by two pins                     | **Three** — dependency-cruiser is the third                        | And its failure mode is the worst of the three                                                       |
| typescript-eslint gains eslint 10 at 8.65       | It lands at **8.60.0**                                             | 8.60 is the floor, not 8.65                                                                          |

### The severe finding: TS 7 false-greens `validate:arch`

Measured, same config, two TypeScript versions:

```
TS 5.9.3   x 2 dependency violations (0 errors, 2 warnings). 438 modules, 1792 dependencies cruised.
TS 7.0.2   ✔ no dependency violations found (0 modules, 0 dependencies cruised)
           warning missing-typescript-transpiler: not a compatible TypeScript compiler
                   (typescript: >=2.0.0 <7.0.0)
```

**`validate:arch` exits 0 while enforcing nothing.** `validate:all` and CI go green with every
layer boundary and cycle rule silently switched off — a warning, not an error. This is the same
shape as the `|| true` that hid a missing `skills/` directory for months, and it is exactly why
TS 7 must not be attempted opportunistically.

### D-1 — TypeScript 5.9.3 → 6.0.3 · **verified green in scratch**

| #    | Status | File                                   | Change                                                                                        | ~Lines | Depends    | Verify                                                                                                                            |
| ---- | ------ | -------------------------------------- | --------------------------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| D1.1 | ✓      | `server/jest.config.cjs:17`            | `moduleResolution: 'node'` → `'bundler'`                                                      | 1      | —          | Without it every suite dies on `TS5107: Option 'moduleResolution=node10' is deprecated`. Measured: fails before, 29/29 pass after |
| D1.2 | ✓      | `server/package.json`                  | `typescript-eslint` 8.53.0 → ^8.60.0 (peers `<6.1.0`)                                         | 1      | —          | `npm ls` clean — 8.53 peers `<6.0.0` and would go invalid                                                                         |
| D1.3 | ✓      | `server/package.json`                  | `typescript` → ^6.0.3                                                                         | 1      | D1.1, D1.2 | `npx tsc --noEmit` 0 errors                                                                                                       |
| D1.4 | ✓      | `server/.eslint-ratchet-baseline.json` | Re-baseline **only** `@typescript-eslint/no-unnecessary-type-assertion` 0 → 33, or fix the 33 | ~2     | D1.2       | See the re-baselining rule below — prefer fixing                                                                                  |

Agent-measured on the scratch copy: `tsc --noEmit` 0 errors · `validate:arch` **438 modules,
1792 deps** (unchanged, so no false green) · full lint **3477e/1432w, zero per-rule delta** ·
**146 suites / 1732 tests passed**.

**Gate**: `validate:all` 0 · `lint:ratchet` no regressions · `test:ci` 1732 · `test:integration`
426 · `test:e2e` 36 · `verify:mcp` 11/11 · `validate:tool-schemas` 0 · `validate:arch` still
cruising 438 modules — assert the module count, not just the exit code.

### D-2 — ratchet: detect a vanished rule (do this before D-3)

| #    | Status | File                                      | Change                                                                                             | ~Lines | Depends | Verify                                                                                                                |
| ---- | ------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------- | ------ | ------- | --------------------------------------------------------------------------------------------------------------------- |
| D2.1 | ✓      | `server/scripts/eslint-ratchet.js:83-114` | In `compareSummaries`, add: baseline has the rule ID, current does not → push a `vanished` finding | ~15    | —       | **Force a failure**: delete a rule ID from the baseline, run `lint:ratchet`, confirm non-zero exit naming it; restore |
| D2.2 | ✓      | `server/scripts/eslint-ratchet.js`        | Print vanished rules under their own heading                                                       | ~8     | D2.1    | The D2.1 probe shows the rule under the new heading                                                                   |

`compareSummaries` (`:83`) **already unions** baseline and current rule IDs at 86-89. The gap is
at 92-93: the absent current side defaults to `{errors: 0, warnings: 0}` and the only test is
`current > baseline`, so `0 > N` never fires.

The agent found **zero rules vanish** under eslint 10 itself — but D-3's plugin swap renames four
rule IDs, which is a vanish by any other name. This check is what makes that rename reviewable.

### D-3 — ESLint 9 → 10 + `eslint-plugin-import` → `import-x`

`eslint-plugin-import@2.32.0` does not merely warn under ESLint 10 — it **crashes**:

```
TypeError: sourceCode.getTokenOrCommentAfter is not a function
  Rule: "import/order"   at eslint-plugin-import/lib/rules/order.js:31
```

2.32.0 is the latest and there is no eslint-10 release. `eslint-plugin-import-x@4.17.1` declares
`^10.0.0` — but it is a **plugin swap, so rule IDs become `import-x/*`**.

| #    | Status | File                                                            | Change                                                                                                                                   | ~Lines | Depends | Verify                                                                                                                          |
| ---- | ------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| D3.1 | ✓      | `server/package.json`                                           | `eslint-plugin-import` → `eslint-plugin-import-x@^4.17.1`                                                                                | 1      | D2.1    | `npm ci` clean                                                                                                                  |
| D3.2 | ✓      | `server/eslint.config.js:3, 46, 223`                            | Swap import and **both** registrations; `plugins: { 'import-x': … }`                                                                     | 3      | D3.1    | Plugin resolves                                                                                                                 |
| D3.3 | ✓      | `server/eslint.config.js:94,123,124,125` and `:269,298,299,300` | Rename all 8 rule references `import/*` → `import-x/*`                                                                                   | 8      | D3.2    | No "Definition for rule not found"                                                                                              |
| D3.4 | ✓      | `server/.eslint-ratchet-baseline.json`                          | Rename the four `import/*` keys to `import-x/*` **in place, preserving counts**, then run `lint:ratchet check` — never `update-baseline` | ~4     | D3.3    | Passes → coverage transferred. Fails → import-x found more. Passes with slack → it found **less**, investigate before accepting |
| D3.5 | ✓      | `server/package.json`                                           | `eslint` ^10.8.0 + `@eslint/js` ^10.0.1 (locked together — `@eslint/js` peers `^10.0.0`)                                                 | 2      | D3.4    | `npx eslint --version` → 10.x                                                                                                   |
| D3.6 | ✓      | `server/eslint-rules/claude-plugin.js`                          | Verify all **four** local rules still fire                                                                                               | 0-20   | D3.5    | One violating fixture per rule, each reported                                                                                   |
| D3.7 | ✓      | `server/.eslint-ratchet-baseline.json`                          | `no-useless-assignment` 0 → 8 and `preserve-caught-error` 0 → 4 — **fix, do not baseline**                                               | ~12    | D3.6    | `lint:ratchet` 0                                                                                                                |

`eslint-config-prettier`, `eslint-plugin-prettier` and `eslint-plugin-sonarjs` need **no** bump —
sonarjs 4.2.0 already declares `^10.0.0`.

**Gate**: as D-1, plus zero vanished rules that are not the four deliberate `import-x` renames.

### What execution corrected in D-1..D-3

Recorded as corrections rather than folded in silently — four of these contradict what this
section asserted before it was run.

| The plan said                                      | Execution measured                                                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| D3.4 renames **four** `import/*` baseline keys     | **Two** — `import/order` and `import/no-duplicates`. The "8 rule references" in D3.3 was right; the key count was not                                |
| D2.1's probe: "delete a rule ID from the baseline" | That produces an **increase**, which the old code already caught. A vanish needs a rule **added** to the baseline that the current run cannot emit   |
| D3.7: fix `preserve-caught-error`                  | Needs `tsconfig.json` `lib: ES2020` → **ES2022** — `cause` is an ES2022 signature, so the fix does not compile without it                            |
| import-x behavioural equivalence "unmeasured"      | **Measured equivalent.** `import/order` actual was **5** (the baseline's 7 was stale slack); `import-x/order` is also 5. `no-duplicates` 2 both ways |

**Two latent defects found by D3.6, both pre-existing and neither caught by any gate:**

1. `eslint-rules/claude-plugin.js:245` called `context.getFilename?.()`. **ESLint 10 removed
   `context.getFilename()` and `context.getSourceCode()`** (verified against the Linter API). The
   optional call yielded `undefined`, `?? ''` made it an empty string, and the `allowInternal`
   exemption silently stopped applying. Line 50's `context.sourceCode ?? context.getSourceCode()`
   was safe only because `??` short-circuits.
2. The same guard tested for `/src/execution/context/`, but the layer restructure moved that
   directory to `/src/engine/execution/context/`. So `allowInternal: true` had been dead **twice
   over**, and fixing only the API would not have revived it. Zero current violations, so the
   correction changed no counts; verified both ways — flagged outside the directory, exempt inside.

**`claude/no-emojis` is dead config**: the plugin defines and exports it, and no ESLint config
anywhere enables it. Three local rules are live, not four. Left as-is — enabling it is a separate
decision with its own violation backlog.

**Not a gate problem, but present**: `server/undefined/tmp/repro.mjs` exists (dated 2026-08-01
03:52, origin unknown) and contributes 78 of the problems in `npm run lint`. It is invisible to
`git status` because its only content sits under a gitignored `tmp/`. No gate sees it —
`lint:ratchet` scopes to `src` — but `npm run lint` output is polluted until it is removed.

**Final counts**: 3471 errors / 1428 warnings, **zero rules increased** against the pre-tier
actual (3477/1432). Every decrease is attributable to this tier: −33 `no-unnecessary-type-assertion`
(fixed, not baselined), −4 `no-explicit-any` and −4 `no-unsafe-assignment` from the four `as any`
sites the cleanup removed, −1 `no-unnecessary-condition`, −1 `no-unused-vars`. The ratchet baseline
file changed by exactly two key renames, counts preserved; `update-baseline` was never run.

### D-4 — TypeScript 7 · **BLOCKED, no steps**

`tsc` itself is ready — TS 7.0.2 typechecks this codebase with **0 errors in 0.71s** (vs 3.87s on
5.9.3), and `--project tsconfig.json` works verbatim. Everything downstream of it is not:

| Predicate                             | Check                                                    | Currently                                                                      |
| ------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| dependency-cruiser cruises >0 modules | `npm run validate:arch` prints a non-zero module count   | **0 modules, exits 0** — false green. Now mechanically enforced, see below     |
| ts-jest admits TS 7                   | `npm view ts-jest peerDependencies.typescript`           | `>=4.3 <7`; hard runtime guard, all suites fail to run                         |
| typescript-eslint admits TS 7         | `npm view typescript-eslint peerDependencies.typescript` | `<6.1.0`; explicit `versionMajor >= 7` throw, upstream #10940 targets **≥7.1** |

All three must pass. Note the ts-jest error message suggests installing `@typescript/native` —
**that package does not exist on npm** (404), so the documented escape hatch is partly bogus.

### Why all three blockers are one blocker (measured 2026-08-02)

TypeScript 7 is the Go-native compiler and it **removed the JS compiler API**:

|                         | TS 6.0.3     | TS 7.0.2                               |
| ----------------------- | ------------ | -------------------------------------- |
| `require('typescript')` | 2248 symbols | **2** (`version`, `versionMajorMinor`) |
| `ts.createProgram`      | function     | `undefined`                            |
| `lib/`                  | 24 MB        | 24 KB (`tsc.js`, `getExePath.js`)      |

The API moved behind `./unstable/sync`, `./unstable/ast`, … — upstream's own naming. So ts-jest,
typescript-eslint and dependency-cruiser are not three independent laggards; each has to be
rewritten against an API its author labels unstable. Realistic unblock is TS 7.1+.

### The deferral is now enforced, not remembered

`scripts/validate-arch.js` wraps dependency-cruiser and asserts it cruised at least 400 modules
(today: 438). Verified end-to-end, not just by self-test: with `typescript@7.0.2` actually
installed, `validate:arch` exits **1** and `validate:all` exits **1**; restored to 6.0.3 both
return 0. The floor only trips on a drop, so `src/` growth needs no maintenance.

`.github/renovate.json5` carries the three predicates as `prBodyNotes` on the TypeScript rule, so
they appear in the PR body itself. Deliberately **not** an `allowedVersions` pin: both former
holds were retired by finishing their migrations rather than relaxing a rule, and a pin would
also block the TS 6.x patches we want.

### Also found while measuring — not TS 7 related

`tsconfig.json:18` sets `isolatedModules: true`, and ts-jest branches on exactly that
(`ts-compiler.js:78`) into `transpileModule`, never building a language service. **ts-jest
type-checks nothing here** — a `const n: number = 'a string'` in a test file passes. Meanwhile
`typecheck:tests` inherits `rootDir: "./src"` while including `tests/**/*`, so it dies on TS6059,
and it is gated nowhere. Fixing `rootDir` reveals **974 errors (869 in `tests/`, 0 in `src/`)`.

Consequence for the swap: `@swc/jest` was measured at full parity (146/146 suites, 1732/1732
tests, ~34.5s vs ~36.2s) and depends on no `typescript` package at all — but it would replace a
transpiler with a transpiler, so it does not unblock TS 7 and loses no type safety, because there
is none to lose. Deferred; the test-typecheck gap is the larger and more valuable item.

### Risks

| Risk                                                                    | Impact                                                              | Mitigation                                                                                      | Rollback                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------- |
| TS 7 attempted opportunistically                                        | `validate:arch` silently enforces nothing while CI is green         | D-4's first predicate asserts a non-zero module count, not exit 0                               | Revert TypeScript             |
| The `import-x` rename reads as 7 fixed + N new                          | Coverage loss laundered as improvement                              | D2.1 lands first; D3.4 renames baseline keys in place and uses `check`, never `update-baseline` | Restore the baseline from git |
| Baselining the 45 new errors instead of fixing them                     | A one-time cleanup becomes permanent debt the ratchet then protects | D1.4/D3.7 say fix; baseline only what is consciously declined, and say so in the commit         | n/a                           |
| Committed ceiling (3596/1541) has 119/109 slack over actual (3477/1432) | A decrease from lost detection hides inside the slack               | Compare against the **actual** prior run, not the committed ceiling                             | n/a                           |
| The 4 local plugin rules break on the ESLint 10 API                     | Custom invariants stop firing with no error                         | D3.6 forces a violation per rule                                                                | Pin eslint back to ^9         |

### Not verified — carry into execution

- `eslint-plugin-import-x` behavioural equivalence on this config. The `import/order` group config
  at `eslint.config.js:94-122` is nontrivial and post-swap counts are **unmeasured**. D3.4 is
  designed so this surfaces rather than passes silently.
- Integration (426) and e2e (36) suites under TS 6 — only the 146 unit suites were run.
- The `cli` workspace under TS 6. It declares its own `typescript: ^5.9.3` and CI runs
  `npm -w cli run typecheck` (`ci.yml:120`). Untouched by the scratch run.
- Full eslint-10 counts with import rules enabled — impossible while the old plugin crashes.
- `ts-morph` / `madge` under TS 6 (neither is in `validate:all`).

### Release

- **commit_convention**: `chore(deps): …` for D-1 and D-3 · `refactor(server): …` for D-2
- **scope**: `server`, `deps`, `scripts`

## Sequencing

```
PR #170 (open) ──┐
                 ├──> Tier C   (both edit .github/renovate.json5)
Tier A ──> Tier B ┘
```

Tier A and Tier B may proceed immediately and in that order. Tier C waits on #170. Tier D waits on
research. **No tier collides with the concurrent
`plans/techincal_debt/pipeline-defect-remediation-2026-08-01.md` work** — finding 8 shows zero zod
and zero js-yaml importers under `server/src/engine/execution/pipeline/`.

## Changelog

| Tier | Section                   | Entry                                                                                                                                                                                                                                               |
| ---- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | Maintenance               | commitlint 21, lint-staged 17, dependency-cruiser 18, knip 6                                                                                                                                                                                        |
| B    | Changed                   | js-yaml 5 — `load` now defaults to `CORE_SCHEMA`; workspace-overlay YAML relying on `!!merge` or empty documents may need review. `@types/diff` removed; diff v9 self-types                                                                         |
| C    | Changed _or_ **BREAKING** | decided by C7's schema diff — not before                                                                                                                                                                                                            |
| D    | Maintenance _and_ Changed | TypeScript 6.0.3, ESLint 10, `eslint-plugin-import` → `import-x`. **Changed**: `tsconfig.json` `lib` ES2020 → ES2022 (required for `Error(msg, { cause })`); 33 redundant type assertions and 12 new ESLint 10 findings fixed rather than baselined |

---

## Validation & Completion

### Testing strategy

| What to test                                                             | Test type             | Location                                                  | Why this type                                                                                                             |
| ------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| All 74 bundled YAML resources still parse under js-yaml 5                | integration           | `server/tests/integration/yaml-corpus.test.ts` (new)      | Real files through the real parser; a unit test with a fixture string would not catch a corpus-specific strictness change |
| Emitted MCP `inputSchema` for all 3 tools, before vs after zod 4         | integration snapshot  | `server/tests/integration/mcp-input-schema.test.ts` (new) | The artifact under test is produced by the SDK at registration time — only an end-to-end capture sees it                  |
| `resource_manager action:compare` returns a non-empty patch under diff 9 | existing integration  | extend current resource-manager suite                     | Typecheck alone cannot catch a changed return shape                                                                       |
| commitlint still rejects an invalid scope                                | manual forced failure | —                                                         | A green suite proves nothing; only a rejection proves the rule survives                                                   |
| `validate:arch` still rejects a cross-layer import                       | manual forced failure | —                                                         | dependency-cruiser 18 may silently no-op a stale config and still exit 0                                                  |

### Done criteria

| Criterion                          | Validation                                 | Pass condition                               |
| ---------------------------------- | ------------------------------------------ | -------------------------------------------- |
| Each tier independently shippable  | `npm run validate:all` after each          | exit 0                                       |
| No lint regressions                | `npm run lint:ratchet`                     | no increase over 3475 errors / 1434 warnings |
| Test suite intact                  | `npm run test:ci`                          | 146 suites / 1732 tests green                |
| MCP server actually starts         | `npm run verify:mcp`                       | all 3 tools answer                           |
| `@types/diff` retired              | `npm run typecheck` after removal          | passes — proves diff v9 self-types           |
| `zod-to-json-schema` retired       | `rg -n "zod-to-json-schema" src/ scripts/` | 0 hits                                       |
| Contract decision made on evidence | C7 diff                                    | enumerated in the PR body, not summarised    |

### Documentation

| Doc                              | Update needed                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `CHANGELOG.md`                   | Tier B — js-yaml 5 default-schema change + `@types/diff` removal. Tier C — entry written only after C7 |
| `.claude/rules/mcp-contracts.md` | If C7 shows a schema delta, record that the SDK's converter is version-dependent                       |
| `CLAUDE.md` §Public API Contract | Only if C7 forces a major                                                                              |
| `.github/renovate.json5`         | zod hold removed with a comment stating what satisfied it                                              |

### Risks

| Risk                                                 | Impact                                                  | Mitigation                                                                        | Rollback                                           |
| ---------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------- |
| zod 4 changes emitted JSON Schema                    | **breaking** — every MCP client sees a new tool surface | C1 snapshot before migrating; C7 diff decides the version                         | revert the PR; snapshot stays as a permanent guard |
| js-yaml 5 rejects workspace-overlay YAML             | user resources stop loading                             | Bundled corpus covered by B4; overlays cannot be probed — documented in CHANGELOG | revert to `js-yaml` 4                              |
| `onWarning` removal breaks an importer               | compile failure across 7 files                          | Probe `rg -n "\.warnings" server/src/` before choosing                            | contained in one wrapper                           |
| dependency-cruiser 18 silently no-ops a stale config | `validate:arch` passes while enforcing nothing          | Forced-failure check in A3                                                        | pin back to 17.4.3                                 |
| Tier C rebase reinstates the express hold            | a removed hold returns unnoticed                        | Merge #170 before Tier C branches                                                 | re-apply #170's diff                               |

### Release

- **commit_convention**: `chore(deps): ...` for A and B-2 · `refactor(server): ...` for B-1 and C code changes
- **scope**: `deps`, `server`, `contracts`

### Growth capture

- [ ] **Pattern**: probe the published tarball (`npm pack`) and the dependency's own `action.yml`/`.d.ts` rather than trusting release notes — release notes for diff v9, checkout v7 and setup-node v7 were all too thin to decide on. Candidate for `/docs`.
- [ ] **Trap**: `rg -rn` — in ripgrep `-r` is `--replace`, so `-r n` silently rewrites every match to `n`. Cost several corrupted search outputs this session. Candidate for `/search` or `cli-tools.md`.
- [ ] **Memory**: this plan supersedes nothing; add a pointer under Active Initiatives.
