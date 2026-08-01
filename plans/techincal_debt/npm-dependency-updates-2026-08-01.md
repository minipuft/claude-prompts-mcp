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

`js-yaml` 5 is a TypeScript rewrite with a reorganised public API. Two removals hit
`server/src/shared/utils/yaml/yaml-parser.ts` — the single chokepoint all 7 importers pass through.

| #   | File                                                      | Change                                                                     | ~Lines | Depends | Verify                                        |
| --- | --------------------------------------------------------- | -------------------------------------------------------------------------- | ------ | ------- | --------------------------------------------- |
| B1  | `server/package.json`                                     | `js-yaml` → ^5.2.3 (+ drop `@types/js-yaml` if v5 self-types)              | 2      | —       | `npm ci` clean                                |
| B2  | `server/src/shared/utils/yaml/yaml-parser.ts:82`          | drop `yaml.DEFAULT_SCHEMA`; v5 `load` defaults to `CORE_SCHEMA`            | ~3     | B1      | `npm run typecheck`                           |
| B3  | `server/src/shared/utils/yaml/yaml-parser.ts:17,22,84-86` | resolve the `onWarning` removal across the **exported** `YamlParseOptions` | ~15    | B2      | `npm run typecheck` + the 7 importers compile |
| B4  | `server/tests/integration/yaml-corpus.test.ts` **(new)**  | load all 74 bundled YAML resources; assert each parses non-empty           | ~40    | B2, B3  | fails if any resource stops parsing           |

**The B3 decision** (not pre-decided here — it depends on whether any caller reads `warnings`):
`YamlParseOptions.onWarning` and `YamlParseResult.warnings` are exported. Either preserve the
field via another mechanism, or propagate the removal to all 7 importers. Probe first:
`rg -n "\.warnings" server/src/` across the importers.

### B-2: diff 8.0.4 → 9.0.0 + retire @types/diff

| #   | File                                                                               | Change                                    | ~Lines | Depends | Verify                                                      |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------- | ------ | ------- | ----------------------------------------------------------- |
| B5  | `server/package.json`                                                              | `diff` → ^9.0.0; **remove `@types/diff`** | 2      | —       | `npm run typecheck` — proves v9's own types resolve         |
| B6  | `server/src/modules/skills-sync/service.ts:17`                                     | confirm `createTwoFilesPatch` signature   | 0-3    | B5      | typecheck                                                   |
| B7  | `server/src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.ts:3` | confirm `createPatch`, `structuredPatch`  | 0-3    | B5      | `resource_manager action:compare` returns a non-empty patch |

**Gate**: `npm run validate:all` exit 0 · `test:ci` 146 suites green · `verify:mcp` passes.

**Residual risk (accepted, documented)**: findings 5 and 6 discharge the merge-key and empty-file
hazards for _bundled_ resources. Workspace overlays are user-supplied and cannot be probed from
here — note the js-yaml major in `CHANGELOG.md` under Changed.

---

## Tier C — zod 3 → 4

One PR, staged internally. **Blocked on PR #170 merging first** (finding 10) — both edit
`.github/renovate.json5`, and a rebase could silently reinstate the express hold.

### The contract question

`server/node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-json-schema-compat.js:19-28`:

```js
if (isZ4Schema(schema)) {
  return z4mini.toJSONSchema(schema, {
    target: mapMiniTarget(opts?.target),
    io: opts?.pipeStrategy ?? "input",
  });
}
return zodToJsonSchema(schema, {
  strictUnions: opts?.strictUnions ?? true,
  pipeStrategy: opts?.pipeStrategy ?? "input",
});
```

Two independent implementations of optional/nullable representation, `$ref` handling and draft
targeting. The v3 path passes `strictUnions: true`; the v4 path has no equivalent option.

`CLAUDE.md:125` puts the MCP tool surface inside the Public API Contract. **So the diff decides
the version: empty → 3.x minor; non-empty → 4.0.0.** Do not pre-declare either.

### Migration surface (measured across the 16 importers)

| Pattern              | Sites | zod 4                                           |
| -------------------- | ----- | ----------------------------------------------- |
| `message:`           | 27    | → `error:` — deprecated, still works, may defer |
| `errorMap`           | 8     | → `error` function — **removed**                |
| `invalid_type_error` | 5     | → unified `error` function — **removed**        |
| `.passthrough()`     | 15    | → `z.looseObject()`                             |
| `.strict()`          | 3     | → `z.strictObject()`                            |

| #   | File                                                                                     | Change                                                                                                         | ~Lines | Depends     | Verify                                              |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------ | ----------- | --------------------------------------------------- |
| C1  | `server/tests/integration/mcp-input-schema.test.ts` **(new)**                            | capture `inputSchema` for all 3 tools under **zod 3** to a committed snapshot                                  | ~60    | #170 merged | run on zod 3 — snapshot written and green           |
| C2  | `server/package.json`                                                                    | `zod` → ^4.4.3                                                                                                 | 1      | C1          | `npm ci`                                            |
| C3  | 13 non-MCP zod importers                                                                 | `errorMap`/`invalid_type_error` → `error`; `.passthrough()`/`.strict()` → `z.looseObject()`/`z.strictObject()` | ~45    | C2          | `npm run typecheck`                                 |
| C4  | `server/src/mcp/tools/schemas/{prompt-engine,system-control,resource-manager}.schema.ts` | same migration on the validation SSOT                                                                          | ~15    | C2          | `npm run typecheck`                                 |
| C5  | `server/scripts/generate-framework-schemas.ts:15,27,43`                                  | `zodToJsonSchema()` → `z.toJSONSchema()`                                                                       | ~10    | C2          | `npm run validate:contracts`                        |
| C6  | `server/package.json`                                                                    | **remove `zod-to-json-schema`**                                                                                | 1      | C5          | `rg -n "zod-to-json-schema" src/ scripts/` → 0 hits |
| C7  | —                                                                                        | re-run C1's capture and diff against the snapshot                                                              | 0      | C3, C4      | **the diff IS the deliverable**                     |
| C8  | `.github/renovate.json5:138-140`                                                         | remove the zod hold                                                                                            | 4      | C7          | json5 parses; renovate-config-validator green       |
| C9  | `CHANGELOG.md` / release strategy                                                        | record per C7's outcome                                                                                        | ~5     | C7          | —                                                   |

**Gate**: `validate:all` exit 0 · `test:ci` green · `verify:mcp` passes · C7's diff enumerated in
the PR body, not summarised.

> C6 matters beyond tidiness: leaving `zod-to-json-schema` installed keeps a second converter that
> nothing calls — the parallel-system smell `cleanup-standards.md` exists to prevent. (The SDK
> retains its own copy as a transitive dep; that is the SDK's business, not ours.)

---

## Tier D — TypeScript 7 + ESLint 10 (research only)

**No implementation steps.** These are coupled through `typescript-eslint` 8.53.0 → 8.65.0 and
likely have to move together.

| Package                 | Current → Latest             |
| ----------------------- | ---------------------------- |
| `typescript`            | 5.9.3 → **7.0.2**            |
| `eslint` + `@eslint/js` | 9.39.5 → **10.8.0** / 10.0.1 |
| `typescript-eslint`     | 8.53.0 → 8.65.0              |

### What must be investigated

1. **Does TS 7 change `tsc --noEmit` semantics on this codebase?** The Go-native rewrite is
   advertised as compatible; the only evidence that counts is a run against `strict` source.
2. **What happens to the ratchet?** `lint:ratchet` compares against exactly **3475 errors /
   1434 warnings**. ESLint 10 and a new TS parser will move that number in both directions at
   once, and the ratchet cannot distinguish "fixed" from "no longer detected."
3. **Does `typescript-eslint` 8.65 support both?** It is the joint on which the pair pivots.
4. **Does ts-jest support TS 7?** 146 suites / 1732 tests depend on it.
5. **Does esbuild care?** It strips types rather than typechecking, so probably not — worth a
   single build to confirm rather than assume.

### Evidence that would unblock

- A branch where `npx tsc --noEmit` under TS 7 produces a diffable error list against the 5.9.3 run
- `typescript-eslint` release notes confirming a version supporting ESLint 10 **and** TS 7
- A decision on how the ratchet baseline is re-established — regenerate wholesale, or hold the old
  number and treat every delta as a review item

Until items 1-3 are answered, this tier has no steps and should not acquire any.

---

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

| Tier | Section                   | Entry                                                                                                                                                                       |
| ---- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | Maintenance               | commitlint 21, lint-staged 17, dependency-cruiser 18, knip 6                                                                                                                |
| B    | Changed                   | js-yaml 5 — `load` now defaults to `CORE_SCHEMA`; workspace-overlay YAML relying on `!!merge` or empty documents may need review. `@types/diff` removed; diff v9 self-types |
| C    | Changed _or_ **BREAKING** | decided by C7's schema diff — not before                                                                                                                                    |
| D    | —                         | none                                                                                                                                                                        |

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
