---
title: "Canonical agent instructions and semantic module governance"
date: 2026-08-21
status: reference
tags: [architecture, documentation, validation, dependency-cruiser]
---

# Canonical Agent Instructions and Semantic Module Governance

## Step 1 — Discovery and Triage

### Intent declaration

| Field                 | Decision                                                                                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work type             | `feature`                                                                                                                                                                                                                                                  |
| Secondary type        | `refactor`                                                                                                                                                                                                                                                 |
| Confidence            | High                                                                                                                                                                                                                                                       |
| Problem               | Agent instructions and architecture facts are manually repeated, so they can disagree with each other and with the repository.                                                                                                                             |
| Desired state         | `CLAUDE.md` plus scoped project rules are the authored guidance sources; `AGENTS.md` is their generated client projection; semantic boundaries declare local meaning; dependency-cruiser supplies observed import facts; volatile navigation is generated. |
| Scope                 | Root instruction files, repository/server validation scripts, `server/src` boundary metadata, dependency-cruiser consumption, CI/pre-push routing, and architecture docs.                                                                                  |
| Risk                  | Medium: validation and symlink mistakes can block contributors, but production MCP behavior is outside scope.                                                                                                                                              |
| External dependencies | None. Reuse dependency-cruiser `^18.1.0` (resolved `18.2.0`), js-yaml `^5.2.3`, zod `^4.4.3`, and tsx `^4.21.0`.                                                                                                                                           |
| Source specification  | Owner request dated 2026-08-20/21 and the `>>implementation_plan` chain.                                                                                                                                                                                   |
| Next phase            | `/refactoring`; pre-flight completed in Step 2.                                                                                                                                                                                                            |

### Acceptance criteria

1. `CLAUDE.md` and `.claude/rules/*.md` remain the only authored project-guidance sources.
2. `AGENTS.md` is a tracked, byte-checkable semantic projection generated from those sources and marked as generated for repository tooling.
3. Every direct child of a boundary declaring `children: semantic` has one valid `module.yaml`.
4. Lifecycle, id, kind, description, documentation, and public-entry constraints fail with actionable diagnostics.
5. Dependency-cruiser JSON feeds architecture validation and the module catalog; `.dependency-cruiser.cjs` remains the only permission-policy source.
6. `docs/reference/module-catalog.md` is deterministic, generated, and checked for drift.
7. Existing suite membership, docs-only CI, and pre-push routes enforce the new invariants.
8. The server builds; targeted validation and `validate:all` pass; the write/check catalog flow and isolated scaffold flow are live-driven.

### Discovery findings

- The repository already has the needed harness primitives: `run-validation-suite.js`, suite-membership checks, generator `--check` patterns, self-tests, scope-aware CI, Knip, and dependency-cruiser.
- DeepSeek Harness is therefore a pattern source, not a prerequisite or runtime dependency for this feature.
- `CLAUDE.md` is the more current rule set. `AGENTS.md` still names Node 18, SSE, and removed paths.
- `AGENTS.md` exists locally as a regular file but is excluded by `.git/info/exclude` and is not tracked.
- `CLAUDE.md` is tracked with executable mode `100755`; its content is 258 lines, within the 350-line global budget.
- `docs/architecture/overview.md` contains a stale hand-maintained tree and removed source paths.
- No `module.yaml` exists under `server/src`.
- The real graph currently contains 473 cruised modules and 1,966 dependencies. The existing wrapper parses a human summary and guards only against a false-green graph below 400 modules.
- Current `runtime` and `cli-shared` relationships do not fit a strict extension of the five-layer rules without migration work. This plan exposes those edges but does not encode exceptions or relocate them.

## Step 2 — Design and Pre-flight

### Compound diagnosis

**Duplicate human-maintained authorities + unprojected architecture** → canonicalize instructions and generate current-state views from local semantic declarations plus observed imports.

### Identity before shape

| Property     | Design                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Behavior     | Validate semantic boundary declarations, observe imports, and deterministically render navigation documentation.     |
| State        | Git-tracked descriptor YAML and generated Markdown; no runtime state.                                                |
| Lifecycle    | Descriptors change with their boundary; generated output is rebuilt and checked.                                     |
| Dependencies | Descriptor metadata + dependency-cruiser JSON; permission rules remain in `.dependency-cruiser.cjs`.                 |
| Shape        | Pure TypeScript libraries with thin CLIs; one zero-dependency root JS validator for docs-only CI.                    |
| Placement    | `server/scripts/lib`, `server/scripts`, root `scripts`, colocated `server/src/**/module.yaml`, and `docs/reference`. |

### Goals

1. Establish one instruction source and a machine-verifiable compatibility entrypoint.
2. Describe semantic boundaries locally without requiring metadata in every implementation folder.
3. Validate descriptor completeness and lifecycle references.
4. Generate a current module catalog and collapsed dependency graph.
5. Replace dependency-cruiser text parsing with structured JSON while preserving its policy authority.
6. Consolidate Harness-like patterns into the existing validation suite.

### Non-goals

- Install, bundle, or depend on DeepSeek Harness.
- Build a Harness plugin, UI, telemetry dashboard, or pre/post-message runtime.
- Annotate every nested implementation directory.
- Generate dependency permission rules from descriptors.
- Add a second validation runner.
- Fix the current `runtime/resource-change-tracking` boundary debt.
- Add broad Markdown-link, fenced-code, JSDoc, or documentation-budget enforcement.
- Add a new MCP filesystem mutation tool or another external dependency.

### Pre-flight verdict

| Check               | Verdict | Evidence and consequence                                                                                 |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| Domain              | Pass    | Repository governance belongs in scripts/docs; conversational MCP execution is unchanged.                |
| Layer               | Pass    | Pure script libraries and CLI shells remain outside production orchestration.                            |
| Naming              | Pass    | Names describe semantic descriptors, graph reading, catalog generation, and scaffolding specifically.    |
| Complexity          | Pass    | Recursive child policy + one graph adapter; no general graph framework.                                  |
| Size                | Pass    | Descriptor changes are mechanical; code is split into focused modules.                                   |
| Service/state       | Pass    | No runtime service, singleton, or persistence.                                                           |
| Defined             | Pass    | Behavior, state, lifecycle, dependencies, shape, and placement are explicit.                             |
| Contracts           | Pass    | Descriptor and graph contracts precede implementation.                                                   |
| Pattern/reuse       | Pass    | Reuses generator checks, self-tests, validation suite, dependency-cruiser, and installed schema tooling. |
| Library API/version | Pass    | Installed dependency-cruiser `18.2.0` supports JSON output.                                              |
| Failures            | 0       | No blocking pre-flight finding.                                                                          |

### Semantic descriptor contract

```yaml
schemaVersion: 1
id: workflow-ir
kind: domain
lifecycle: canonical
description: Validates and compiles planner-submitted workflows.
children: internal
docs:
  - docs/reference/workflow-ir.md
publicEntry: index.ts
```

Rules:

- Required fields: `schemaVersion`, globally unique kebab-case `id`, closed-vocabulary `kind`, `lifecycle`, non-empty `description`, and `children`.
- `lifecycle`: `canonical | migrating | legacy`.
- `children`: `semantic | internal`.
- `migrating` and `legacy` require `replacement` referencing another descriptor id and a non-empty `removeWhen` condition.
- Optional `docs` and `publicEntry` paths must resolve.
- The descriptor applies to the semantic boundary, not each nested file.
- Path is derived from descriptor location and is not repeated.
- Dependencies are observed, not manually declared.

Initial `kind` vocabulary:

`application | layer | domain | protocol | adapter | runtime | shared`

### Descriptor coverage policy

- `server/src/module.yaml` is the traversal root and declares `children: semantic`.
- `shared`, `infra`, `engine`, `modules`, and `mcp` are layer descriptors with `children: semantic`.
- `runtime` and `cli-shared` are singleton boundaries with `children: internal`.
- Every direct child of a semantic parent requires exactly one `module.yaml`.
- Domain children initially declare `children: internal`.
- A parent can promote its direct children by changing to `children: semantic`.
- A nested descriptor below an internal boundary fails validation, preventing accidental parallel authorities.

### Authority split

| Fact                                            | Authority                                    |
| ----------------------------------------------- | -------------------------------------------- |
| Boundary meaning, lifecycle, docs, public entry | Colocated `module.yaml`                      |
| What files actually import                      | Dependency-cruiser JSON                      |
| Which imports are allowed                       | `server/.dependency-cruiser.cjs`             |
| Human navigation view                           | Generated `docs/reference/module-catalog.md` |
| Agent working principles and stable ownership   | `CLAUDE.md`                                  |

### Generated module catalog

- Deterministic Markdown with no generated timestamp.
- Do-not-edit marker.
- Table: id, path, kind, lifecycle, description, docs, public entry, observed dependencies, imported-by.
- Mermaid graph collapsed to the nearest descriptor boundary.
- External and self edges excluded.
- An aggregate edge is value-bearing when any underlying edge is not type-only.
- `.dependency-cruiser.cjs` remains the permission SSOT; the generator reads facts only.

### Dependency-cruiser migration

1. Add a typed graph adapter that runs `depcruise --config .dependency-cruiser.cjs -T json src`.
2. Validate the required `modules` and `summary` structure and fail closed on malformed or empty output.
3. Migrate `validate-arch.js` to `validate-arch.ts`; preserve the 400-module floor, failure semantics, and self-test.
4. Delete the JavaScript implementation in the same tier.
5. Update the stale measured-count comment to 473 without raising the false-green floor.
6. Let validator and generator run dependency-cruiser independently; measure suite cost before caching or parallelizing.
7. Do not add a runtime inbound rule in this plan; existing consumers need relocation, not exceptions.

### Instruction-source migration — superseded during execution

1. Audit requirements unique to `AGENTS.md`; move only still-current rules into `CLAUDE.md`.
2. Remove stale AGENTS-only claims rather than merging them.
3. Mark `CLAUDE.md` as the maintained instruction source and normalize it to `0644`.
4. Replace `AGENTS.md` with the relative symlink `CLAUDE.md` and require Git mode `120000`.
5. Add `scripts/validate-agent-instruction-source.js` with `--self-test`.
6. Check link text, target resolution, source marker, line budget, working-tree types, and Git mode when indexed.
7. Run the check in the full suite and docs-only CI/pre-push routes.
8. Document that native Windows with `core.symlinks=false` may materialize the link as text; do not claim universal native-Windows behavior.

The owner superseded this symlink shape on 2026-08-23 after re-measurement found the completed
project-guidance projection work. The execution contract is now: preserve `CLAUDE.md` plus scoped
rules as authored sources; keep `AGENTS.md` as their deterministic, committed, client-consumed
projection; and mark the projection as generated rather than treating it as hand-authored source.

### Harness-pattern disposition

| Disposition | Patterns                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adopt       | One home per fact, source symlink, colocated semantic metadata, generated docs with `--check`, cross-platform path normalization, planted-failure self-tests. |
| Consolidate | Existing suite runner, membership checks, package checks, Knip, and dependency-cruiser policy.                                                                |
| Defer       | General link/type-fence/export-doc checks, workspace/runtime closure, broad doc budgets, parallel gate scheduling.                                            |
| Reject      | Copying DeepSeek `run-gates` or creating another architecture-policy source.                                                                                  |

### Alternatives rejected

| Alternative                                | Reason                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| Central descriptor manifest                | Recreates directory drift at a distance.                                    |
| Descriptor in every folder                 | Annotation cost overwhelms semantic signal.                                 |
| Generate permission rules from descriptors | Mixes semantic navigation with enforcement and creates competing authority. |
| Install DeepSeek Harness                   | Adds user burden without supplying a missing lifecycle primitive.           |
| Generate AGENTS as copied text             | A committed copy can still become a second authority.                       |
| Infer boundaries from README/index files   | Their existing roles are inconsistent and semantically different.           |

### Read before implementing

- `CLAUDE.md`, `AGENTS.md`
- `package.json`, `server/package.json`
- `server/.dependency-cruiser.cjs`
- `server/scripts/validate-arch.js`
- `server/scripts/run-validation-suite.js`
- `server/scripts/validate-suite-membership.js`
- `server/scripts/generate-gate-index.js`
- `scripts/classify-validation-scope.js`
- `scripts/render-distributions.mjs`
- `.github/workflows/ci.yml`, `.husky/pre-push`
- `docs/README.md`, `docs/architecture/overview.md`
- The immediate `server/src` directory tree

## Step 3 — Verified Paths

### Verification method

Every existing file above was probed with `ls -la`, `wc -l`, targeted `rg -n`, and `head -10`. The source tree was listed to depth two, descriptors were searched recursively, dependency-cruiser consumers were traced, and Git index/ignore state was checked.

### Raw verification evidence

```text
$ ls -la CLAUDE.md && wc -l CLAUDE.md
-rwxr-xr-x 1 minipuft minipuft 30765 Aug 18 21:25 CLAUDE.md
258 CLAUDE.md
$ rg -n 'Source of Truth|Domain Ownership' CLAUDE.md
3:**Source of Truth**: `server/dist/**`. Confirm behavior there before describing or modifying functionality.
130:## Domain Ownership Matrix (ENFORCED)

$ ls -la AGENTS.md && wc -l AGENTS.md
-rw-r--r-- 1 minipuft minipuft 10776 Aug  2 05:26 AGENTS.md
103 AGENTS.md
$ rg -n 'Node.js|STDIO|SSE' AGENTS.md
32:## Domain Guidance (Node.js + TypeScript MCP Stack)
33:- Use Node.js `>=18.18.0` (CI verifies 18→24).
37:- Avoid introducing unmanaged global state or side effects that could break STDIO/SSE transports.
44:- **Transport Parity**: Ensure changes remain compatible with both STDIO and SSE transports.

$ git ls-files -s CLAUDE.md AGENTS.md
100755 0b813e9d8baf9126cac1282eecb45362171f6742 0 CLAUDE.md
$ git check-ignore -v AGENTS.md
.git/info/exclude:10:AGENTS.md AGENTS.md

$ wc -l package.json server/package.json server/.dependency-cruiser.cjs
33 package.json
266 server/package.json
317 server/.dependency-cruiser.cjs
$ rg -n 'validate:arch|generate:contracts' server/package.json
88:    "validate:arch": "node scripts/validate-arch.js",
91:    "generate:contracts": "tsx scripts/generate-contracts.ts",
$ head -10 server/.dependency-cruiser.cjs
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // 5-LAYER ARCHITECTURE BOUNDARIES
    // Layer hierarchy: shared(L0) → infra(L1) → engine(L2) → modules(L3) → mcp(L4)

$ wc -l server/scripts/validate-arch.js
204 server/scripts/validate-arch.js
$ rg -n 'MODULE_FLOOR|assessCruiseRun|spawnSync' server/scripts/validate-arch.js
49:const MODULE_FLOOR = 400;
62:export function assessCruiseRun({ output, exitCode, floor = MODULE_FLOOR }) {
96:  const result = spawnSync(bin, ['--config', '.dependency-cruiser.cjs', 'src'], {

$ wc -l server/scripts/run-validation-suite.js server/scripts/validate-suite-membership.js
513 server/scripts/run-validation-suite.js
437 server/scripts/validate-suite-membership.js
$ rg -n 'export const SUITE|validate:arch' server/scripts/run-validation-suite.js
71:export const SUITE = [
106:    script: 'validate:arch',
$ rg -n 'import.*SUITE|suite: SUITE' server/scripts/validate-suite-membership.js
51:import { SUITE } from './run-validation-suite.js';
360:    suite: SUITE,

$ wc -l server/scripts/generate-gate-index.js scripts/render-distributions.mjs
185 server/scripts/generate-gate-index.js
453 scripts/render-distributions.mjs
$ rg -n -- '--check|INDEX_PATH' server/scripts/generate-gate-index.js
9: *   node scripts/generate-gate-index.js [--check]
21:const INDEX_PATH = join(GATES_DIR, '_index.md');
22:const CHECK_MODE = process.argv.includes('--check');
$ ls -la server/resources/gates/_index.md && wc -l server/resources/gates/_index.md
-rw-r--r-- 1 minipuft minipuft 6464 Aug 15 00:19 server/resources/gates/_index.md
73 server/resources/gates/_index.md

$ wc -l scripts/classify-validation-scope.js .github/workflows/ci.yml .husky/pre-push
169 scripts/classify-validation-scope.js
504 .github/workflows/ci.yml
221 .husky/pre-push
$ rg -n 'AGENTS|CLAUDE|scope: "docs"' scripts/classify-validation-scope.js
9:  "AGENTS.md",
11:  "CLAUDE.md",
78:    scope: "docs",
$ rg -n 'Validate CONTRIBUTING|Validate plan row|scope == .docs.' .github/workflows/ci.yml
155:      - name: Validate CONTRIBUTING commands (docs route)
156:        if: needs.classify.outputs.scope == 'docs'
164:      - name: Validate plan row tracking (docs route)
165:        if: needs.classify.outputs.scope == 'docs'
$ rg -n 'VALIDATION_SCOPE.*docs|validate-plan-row' .husky/pre-push
86:if [ "$VALIDATION_SCOPE" = "docs" ]; then
109:  node server/scripts/validate-plan-row-tracking.js || {

$ wc -l docs/README.md docs/architecture/overview.md
79 docs/README.md
908 docs/architecture/overview.md
$ rg -n 'server/src/|server/transport|server/src/execution|server/src/chain-session' docs/architecture/overview.md
151:server/src/
154:├── server/transport/           # STDIO + Streamable HTTP protocol handlers
225:| Modify pipeline stage | `server/src/execution/pipeline/stages/`
229:| Debug session issues  | `server/src/chain-session/` + `runtime-state/state.db`

$ find server/src -mindepth 1 -maxdepth 2 -type d | sort
server/src/cli-shared
server/src/engine
server/src/engine/execution
server/src/engine/frameworks
server/src/engine/gates
server/src/engine/interfaces
server/src/infra
server/src/infra/config
server/src/infra/database
server/src/infra/hooks
server/src/infra/http
server/src/infra/logging
server/src/infra/observability
server/src/mcp
server/src/mcp/contracts
server/src/mcp/http
server/src/mcp/metadata
server/src/mcp/tools
server/src/modules
server/src/modules/automation
server/src/modules/chains
server/src/modules/formatting
server/src/modules/hot-reload
server/src/modules/prompts
server/src/modules/resources
server/src/modules/semantic
server/src/modules/skills-sync
server/src/modules/text-refs
server/src/modules/versioning
server/src/modules/workflow-ir
server/src/runtime
server/src/shared
server/src/shared/core
server/src/shared/types
server/src/shared/utils
$ find server/src -name module.yaml -print

$ node -e 'const p=require("./server/node_modules/dependency-cruiser/package.json"); console.log(p.version)'
18.2.0
$ rg -n 'dependency-cruiser|js-yaml|zod|tsx' server/package.json
234:    "js-yaml": "^5.2.3",
237:    "zod": "^4.4.3"
247:    "dependency-cruiser": "^18.1.0",
262:    "tsx": "^4.21.0",
```

### Verified-path inventory

| File                                          |     Lines | Shim | Verified symbol/state                                     | Revision consequence                           |
| --------------------------------------------- | --------: | ---- | --------------------------------------------------------- | ---------------------------------------------- |
| `CLAUDE.md`                                   |       258 | No   | Source marker line 3; ownership line 130; mode 100755     | Add instruction-source marker; normalize mode. |
| `AGENTS.md`                                   |       103 | No   | Regular, excluded, untracked; stale transport/floor rules | Audit then replace with tracked link.          |
| `package.json`                                |        33 | No   | Existing scripts registry                                 | Add root instruction command.                  |
| `server/package.json`                         |       266 | No   | `validate:arch` line 88                                   | Rewire and add semantic commands.              |
| `server/.dependency-cruiser.cjs`              |       317 | No   | Five-layer policy begins line 3                           | Clarify composition/adapter roles only.        |
| `server/scripts/validate-arch.js`             |       204 | No   | Floor line 49; parser line 62                             | Replace with typed JSON consumer.              |
| `server/scripts/run-validation-suite.js`      |       513 | No   | `SUITE` line 71; arch member line 106                     | Add new members.                               |
| `server/scripts/validate-suite-membership.js` |       437 | No   | `SUITE` import line 51                                    | Reuse generic membership behavior.             |
| `server/scripts/generate-gate-index.js`       |       185 | No   | `--check`; output path line 21                            | Reuse generator lifecycle pattern.             |
| `scripts/classify-validation-scope.js`        |       169 | No   | Both instruction files classify as docs                   | No classifier change required.                 |
| `scripts/render-distributions.mjs`            |       453 | No   | Deterministic write/check pattern                         | Reference implementation only.                 |
| `.github/workflows/ci.yml`                    |       504 | No   | Docs route lines 151–165                                  | Add zero-dependency check there.               |
| `.husky/pre-push`                             |       221 | No   | Docs route line 86                                        | Add the same invariant.                        |
| `docs/README.md`                              |        79 | No   | Reference/architecture index lines 49–69                  | Add generated catalog link.                    |
| `docs/architecture/overview.md`               |       908 | No   | Stale tree starts line 151                                | Replace volatile inventory.                    |
| `server/src`                                  | Directory | No   | 36 planned descriptor boundaries; zero descriptors today  | Add local metadata by coverage policy.         |

### Drift summary and required revisions

- Major drift: local `AGENTS.md` state and stale architecture inventory.
- Shims detected: none.
- No referenced path returned `ENOENT`.
- The implementing checkout must remove the local AGENTS exclusion or explicitly force-add the symlink during commit preparation.
- Existing generator output is `server/resources/gates/_index.md`; it is a pattern reference, not the new catalog destination.
- All architecture-wrapper consumers must move together: `server/package.json`, `run-validation-suite.js`, `.husky/pre-push`, and any documentation comments found by the final search.

## Step 4 — Implementation Plan

### Tier 1: Canonical instruction projection

| #   | St                                                                                                                                | File                                                                                                                                                                                                                                    | Change                                                                                                           |           ~Lines | Depends  | Verify                                                             | Justification                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------: | -------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1.1 | ⚠ FALSIFIED (2026-08-23 · authored against a stale 103-line local AGENTS file; measured a 176-line generated semantic projection) | `CLAUDE.md`, `AGENTS.md`                                                                                                                                                                                                                | Superseded by 1.4: do not collapse scoped rules into CLAUDE or add symlink-specific guidance.                    |                0 | —        | See implementation notes R1 and `scripts/sync-project-guidance.js` | The newer projection preserves client-specific scoped-rule dispatch.               |
| 1.2 | ⚠ FALSIFIED (2026-08-23 · the projection generator already owns self-test and drift validation)                                   | `scripts/validate-agent-instruction-source.js`                                                                                                                                                                                          | Do not create a competing validator; reuse `scripts/sync-project-guidance.js --self-test/--check`.               |                0 | —        | `rg 'guidance:(sync\|check)' package.json server/package.json`     | One generator/check lifecycle is the authority.                                    |
| 1.3 | ⚠ FALSIFIED (2026-08-23 · owner ruled to preserve generated projection rather than symlink)                                       | `AGENTS.md`                                                                                                                                                                                                                             | Do not create the planned symlink.                                                                               |                0 | —        | Owner ruling R1 in implementation notes                            | A symlink cannot project scoped-rule dispatch for clients without Claude's loader. |
| 1.4 | ✓ DONE (2026-08-23 · generator 11/11; 21,174/32,768 bytes; working-tree/index parity; guidance and suite membership pass)         | `scripts/sync-project-guidance.js`, `CLAUDE.md`, `.claude/rules/*.md`, `AGENTS.md`, `package.json`, `server/package.json`, `server/scripts/run-validation-suite.js`, `.github/workflows/ci.yml`, `.husky/pre-commit`, `.prettierignore` | Integrated the authorized projection work as the canonical Tier 1 implementation.                                |    existing work | —        | Validation ledger 2026-08-23                                       | Owner-approved replacement architecture is reproduced.                             |
| 1.5 | ✓ DONE (2026-08-23 · local exclusion removed; AGENTS marked `linguist-generated`; canonical source mode normalized to 0644)       | `.gitattributes`, `.git/info/exclude`, `AGENTS.md`                                                                                                                                                                                      | Classified `AGENTS.md` as a committed client-consumed generated artifact rather than an authored file.           | +2/local cleanup | 1.4      | `git check-ignore`; attributes search; filesystem mode             | Generated bytes remain the client discovery surface.                               |
| 1.6 | ✓ DONE (2026-08-23 · targeted checks pass; full suite 44/45 with the sole foreign blocker closed by 1.7)                          | Tier 1 artifacts and sibling implementation notes                                                                                                                                                                                       | Reproduced projection self-test, working/index parity, drift, formatting, suite membership, and full validation. |                0 | 1.4, 1.5 | Validation ledger 2026-08-23                                       | Evidence now belongs to this execution.                                            |
| 1.7 | ✓ DONE (2026-08-23 · `plans:retire:check` passes after classifying the explicitly titled proposal as `backlog`)                   | `plans/features/mid-chain-unknown-surfacing-2026-08-20.md`                                                                                                                                                                              | Closed the only full-suite blocker with the repository-supported non-active lifecycle.                           |                1 | —        | `npm --prefix server run plans:retire:check`                       | Full validation is no longer blocked by invalid plan metadata.                     |

**Tier 1 gate:** generator self-test + working-tree/index byte parity + `npm run guidance:check` + suite membership + generated-file classification.

### Tier 2: Semantic descriptor contract and coverage

| #   | St                                                                                                                                              | File                                                                                                                                            | Change                                                               | ~Lines | Depends | Verify                               | Justification                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -----: | ------- | ------------------------------------ | ------------------------------------------------------------ |
| 2.1 | ✓ DONE (2026-08-23 · strict Zod contract, recursive discovery, lifecycle graph, file references, and nearest-boundary mapping typecheck)        | `server/scripts/lib/semantic-module-descriptors.ts`                                                                                             | Implemented the shared pure descriptor contract.                     |   +300 | —       | Typecheck + self-test                | Shared contract serves validator, generator, and scaffolder. |
| 2.2 | ✓ DONE (2026-08-23 · 9/9 planted cases pass, including missing, malformed, duplicate, stale reference, lifecycle, and nested-boundary failures) | `server/scripts/validate-semantic-module-descriptors.ts`                                                                                        | Added deterministic CLI and self-test.                               |   +220 | 2.1     | Direct tsx self-test and real corpus | Focused suite and contributor entrypoint.                    |
| 2.3 | ✓ DONE (2026-08-23 · root traversal finds seven immediate boundaries and 36 descriptors total)                                                  | `server/src/module.yaml`, `server/src/{shared,infra,engine,modules,mcp,runtime,cli-shared}/module.yaml`                                         | Added root/top-boundary descriptors with semantic/internal policies. |    +80 | 2.1     | Real descriptor validation           | Colocated identity, not central inventory.                   |
| 2.4 | ✓ DONE (2026-08-23 · all seven shared/engine children validate)                                                                                 | `server/src/shared/{core,types,utils}/module.yaml`, `server/src/engine/{execution,frameworks,gates,interfaces}/module.yaml`                     | Added canonical descriptors.                                         |    +70 | 2.3     | Real descriptor validation           | Reviewable cohort complete.                                  |
| 2.5 | ✓ DONE (2026-08-23 · all ten infra/mcp children validate; `infra-http` and `mcp-http` are unique)                                               | `server/src/infra/{config,database,hooks,http,logging,observability}/module.yaml`, `server/src/mcp/{contracts,http,metadata,tools}/module.yaml` | Added canonical descriptors and disambiguated ids.                   |   +100 | 2.3     | Real descriptor validation           | Explicit ids avoid leaf-name ambiguity.                      |
| 2.6 | ✓ DONE (2026-08-23 · six module-domain descriptors validate)                                                                                    | `server/src/modules/{automation,chains,formatting,hot-reload,prompts,resources}/module.yaml`                                                    | Added canonical domain descriptors.                                  |    +60 | 2.3     | Real descriptor validation           | First module cohort complete.                                |
| 2.7 | ✓ DONE (2026-08-23 · five remaining descriptors validate and Workflow IR docs resolve)                                                          | `server/src/modules/{semantic,skills-sync,text-refs,versioning,workflow-ir}/module.yaml`                                                        | Added canonical domain descriptors.                                  |    +50 | 2.3     | Real descriptor validation           | Verified semantic tree complete.                             |

**Tier 2 gate:** `npm --prefix server run validate:module-descriptors:self-test && npm --prefix server run validate:module-descriptors && npm --prefix server run typecheck`

### Tier 3: Structured graph, generated view, and scaffolding

| #   | St                                                                                                                        | File                                                                        | Change                                                                                                                                                             |         ~Lines | Depends | Verify                                                         | Justification                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------: | ------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| 3.1 | ✓ (2026-08-23 · 7/7 consumer cases reject malformed/empty output and subprocess failures; real JSON reads 473 modules)    | `server/scripts/lib/dependency-cruiser-graph.ts`                            | Add typed subprocess/JSON parser; expose modules, summary, normalized edges, and concise violations.                                                               |           +240 | —       | Consumer self-tests; real nonzero graph                        | Prevents duplicate graph parsing in validator and generator.    |
| 3.2 | ✓ (2026-08-23 · TS wrapper preserves the 400-module floor and reports 473 modules/1967 dependencies; old JS path removed) | `server/scripts/validate-arch.ts`; remove `server/scripts/validate-arch.js` | Port wrapper to graph adapter, preserve floor/self-test, update measured note, delete legacy path.                                                                 |      +210/-204 | 3.1     | Self-test; real run ≥400; consumer search                      | Typed replacement, not a dual implementation.                   |
| 3.3 | ✓ (2026-08-23 · 5/5 planted catalog cases cover edge collapse, type/value merge, exclusion, ordering, and stable bytes)   | `server/scripts/generate-module-catalog.ts`                                 | Map files to nearest descriptor; aggregate internal edges/type status; render deterministic Markdown; support write, `--check`, and `--self-test`.                 |           +320 | 3.1     | Self-test covers collapse, order, merge, exclusions, and drift | Projection lifecycle must remain separate from validation.      |
| 3.4 | ✓ (2026-08-23 · two writes retain SHA-256 `536505c8…`; `--check` reports all 36 boundaries)                               | `docs/reference/module-catalog.md`                                          | Generate module table and collapsed Mermaid graph with no clock-dependent bytes.                                                                                   | +150 generated | 3.3     | Two runs + `--check` + id count                                | New derived navigation artifact.                                |
| 3.5 | ✓ (2026-08-23 · 7/7 self-test plus isolated CLI drive created/validated/regenerated and refused overwrite)                | `server/scripts/scaffold-module.ts`                                         | Add local CLI requiring root/path/id/kind/lifecycle/description/children; refuse existing or unguarded targets; write directory + descriptor; validate/regenerate. |           +220 | 3.3     | `--self-test` on temporary root                                | Guarded directory creation requested by owner; not an MCP tool. |

**Tier 3 gate:** `npm --prefix server run validate:arch:self-test && npm --prefix server run validate:arch && npm --prefix server run generate:module-catalog -- --check && npm --prefix server run scaffold:module -- --self-test`

### Tier 4: Validation and documentation integration

| #   | St                                                                                                                         | File                                                                                    | Change                                                                                                                                                                   |   ~Lines | Depends | Verify                                             | Justification                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------: | ------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| 4.1 | ✓ (2026-08-23 · all guidance/descriptor/catalog/scaffold/architecture commands resolve; help, checks, and self-tests pass) | `package.json`, `server/package.json`                                                   | Preserve guidance projection commands; register descriptor, catalog, scaffold, and self-test commands; point architecture commands to TS while preserving command names. |   +14/-2 | —       | Enumerate scripts; run help/check/self-test modes  | Existing manifests remain command registries.                    |
| 4.2 | ✓ (2026-08-23 · membership reports 47 suite steps, 6 load-bearing exceptions, and 14/14 planted rule cases)                | `server/scripts/run-validation-suite.js`, `server/scripts/validate-suite-membership.js` | Add instruction-source, descriptor, and catalog checks to canonical SUITE; extend membership logic only if generic discovery cannot express routing.                     |      +25 | 4.1     | Membership check and self-test                     | Extends the single runner instead of adding a Harness scheduler. |
| 4.3 | ✓ (2026-08-23 · lightweight CI and docs-only pre-push routes invoke zero-dependency guidance check; shell parses)          | `.github/workflows/ci.yml`, `.husky/pre-push`                                           | Add instruction validation to docs-only routes; preserve package-command architecture invocation.                                                                        |      +24 | 4.1     | Docs classifier case; shell syntax; workflow parse | Root instruction changes skip the full server suite.             |
| 4.4 | ✓ (2026-08-23 · policy comments name five layers, runtime composition, and CLI adapter; arch remains 0 errors/12 warnings) | `server/.dependency-cruiser.cjs`                                                        | Clarify five-layer policy versus runtime composition and cli-shared adapter; add no runtime exception and apply OQ-2 ruling.                                             |      +15 | —       | Architecture run; compare JSON violation baseline  | Updates the model without moving policy into descriptors.        |
| 4.5 | ✓ (2026-08-23 · stale tree removed; overview and docs index link the generated catalog; paths and catalog check pass)      | `docs/architecture/overview.md`, `docs/README.md`                                       | Replace stale tree and invalid extension paths with stable responsibilities + generated-catalog link; register catalog.                                                  | +35/-100 | —       | Stale-path search; link checks; catalog check      | Stable docs explain intent and delegate inventory to generation. |

**Tier 4 gate:** `npm run guidance:check && npm --prefix server run validate:suite-membership && npm --prefix server run generate:module-catalog -- --check && npm --prefix server run validate:arch`

### Tier 5: Acceptance and migration closeout

| #   | St                                                                                                                            | File                                      | Change                                                                                                         | ~Lines | Depends | Verify                                                                              | Justification                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -----: | ------- | ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| 5.1 | ✓ (2026-08-23 · 11/11 guidance, 9/9 descriptor, 7/7 architecture, 5/5 catalog, 7/7 scaffold, and 14/14 membership cases pass) | Changed validators and generators         | Run every new self-test and real check; record counts and timings.                                             |      0 | —       | Instruction, descriptor, catalog, scaffold, architecture, and membership self-tests | Proves each checker can fail and pass.             |
| 5.2 | ✓ (2026-08-23 · typecheck, lint ratchet, test-type ratchet, 210 unit suites/2730 tests, Knip, and Prettier pass)              | Repository                                | Run targeted validation and repair only implementation-caused failures.                                        |      0 | 5.1     | Typecheck, lint ratchet, test type ratchet, targeted tests, Prettier                | Static and repository contracts before full suite. |
| 5.3 | ✓ (2026-08-23 · build passes; all 47 suite steps pass in 54.3s; catalog SHA stays stable; isolated scaffold drive passes)     | Repository                                | Build, run `validate:all`, execute real catalog write→check, and live-drive scaffold against an isolated root. |      0 | 5.2     | Build + full suite + generation + scaffold flow                                     | Final acceptance is not only synthetic gates.      |
| 5.4 | ✓ (2026-08-23 · diff check and removal searches pass; AGENTS is a 21,174-byte generated regular file; 36 descriptors audited) | Git diff and sibling implementation notes | Audit removal conditions, update rows/evidence, and record timing/deferred debt outside this plan.             |      0 | 5.3     | `git diff --check`; status; targeted search; generated-projection/index summary     | Mandatory migration closeout.                      |

**Tier 5 gate:** Build + `validate:all` + real generation write/check + isolated scaffold live drive + main-thread scope audit.

### New-file justifications

| New path                                                 | Why no existing file owns it                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `AGENTS.md` generated projection                         | Client-consumed compatibility entrypoint generated and byte-checked from canonical sources.         |
| `scripts/sync-project-guidance.js`                       | Projects canonical guidance, enforces the client budget, renders the index, and detects drift.      |
| `server/scripts/lib/semantic-module-descriptors.ts`      | Pure contract is shared by validator, generator, and scaffolder.                                    |
| `server/scripts/validate-semantic-module-descriptors.ts` | Direct validation CLI and suite member.                                                             |
| `server/scripts/lib/dependency-cruiser-graph.ts`         | One structured graph adapter prevents duplicate parsing.                                            |
| `server/scripts/validate-arch.ts`                        | Typed replacement for the deleted JS wrapper.                                                       |
| `server/scripts/generate-module-catalog.ts`              | Write/check projection has a separate lifecycle from validation.                                    |
| `server/scripts/scaffold-module.ts`                      | Safe local creation workflow; validator remains authority.                                          |
| `docs/reference/module-catalog.md`                       | Generated navigation is distinct from existing reference docs.                                      |
| Each of the 36 `module.yaml` files enumerated in Tier 2  | Semantic metadata must be colocated with the boundary it describes; a central file recreates drift. |

### Execution dispatch

| Work                                | Agent       | Reason                                                                                                                 |
| ----------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| Tier 1 instruction audit            | heavy       | Wrong output could silently discard policy.                                                                            |
| Tier 2 descriptor contract          | standard    | Bounded contract with lifecycle/path failures.                                                                         |
| Tier 2 descriptor cohorts           | fast        | Mechanical metadata after contract freeze.                                                                             |
| Tier 3 graph/generator/architecture | heavy       | Wrong approach could duplicate policy or misrepresent dependencies.                                                    |
| Tier 3 scaffolder                   | standard    | Bounded CLI with filesystem safety cases.                                                                              |
| Tier 4 integration/docs             | standard    | Cross-route consumer tracing.                                                                                          |
| Tier 5 acceptance                   | main thread | Gate verdicts, open-question rulings, final live drive, migration closeout, and scope audit stay with the main thread. |

### Open questions

| ID   | Status                                     | Must precede           | Recommended default                                                                                     | Alternative                                                                                    |
| ---- | ------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| OQ-1 | RULED 2026-08-23 → implementation notes R2 | Tier 3 scaffolder      | Include `scaffold:module`; the owner explicitly requested guarded directory creation.                   | Ship validation/generation first and defer creation convenience.                               |
| OQ-2 | RULED 2026-08-23 → implementation notes R3 | Dependency policy edit | Add no new permission rule; document observed roles and keep this delivery focused on structured facts. | Add a cli-shared restriction only after a zero-violation JSON baseline and ownership approval. |
| OQ-3 | RULED 2026-08-23 → implementation notes R4 | Descriptor contract    | Lifecycle describes the semantic boundary only.                                                         | Add nested overrides later after a real mixed-lifecycle migration demonstrates need.           |

### Changelog entry

**Added:** Canonical agent-instruction linking, validated semantic module descriptors, and dependency-derived architecture documentation.

## Step 5 — Validation and Completion

### Testing strategy

| What to test                                                                     | Test type                                        | Location                                        | Why this type                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| Canonical extraction, scoped-rule dispatch, byte budget, index parity, and drift | Planted-failure self-test + real integration     | `scripts/sync-project-guidance.js`              | The generated client surface must match working-tree and staged canonical inputs. |
| Descriptor schema and lifecycle refinements                                      | Pure unit fixtures inside CLI self-test          | `semantic-module-descriptors.ts`, validator CLI | Fast discrimination for every contract branch.                                    |
| Recursive semantic/internal coverage                                             | Temporary-tree integration                       | Descriptor validator self-test                  | Missing/unexpected directories require real tree traversal.                       |
| Documentation/public-entry resolution and duplicate ids                          | Temporary-tree integration                       | Descriptor validator self-test                  | Resolves paths and cross-descriptor references.                                   |
| Dependency-cruiser subprocess/JSON error handling                                | Unit fixtures + subprocess seam                  | Graph adapter consumers                         | Separates parser failures from real cruising.                                     |
| Real module/dependency counts and violations                                     | Repository integration                           | `validate:arch`                                 | Proves the installed tool parses the actual source corpus.                        |
| Boundary collapse and type/value aggregation                                     | Pure graph fixtures                              | Catalog generator self-test                     | Deterministic logic needs exact edge expectations.                                |
| Generated-byte drift                                                             | Golden/write-check self-test + real corpus check | Catalog generator                               | Proves the check detects a stale committed projection.                            |
| Scaffold input, overwrite refusal, guarded-parent policy                         | Temporary-filesystem integration                 | `scaffold-module.ts --self-test`                | Safety behavior depends on filesystem state.                                      |
| Docs-only enforcement                                                            | Routing integration                              | Classifier, CI workflow, pre-push               | Full suite intentionally does not run on docs-only changes.                       |
| Suite membership                                                                 | Repository integration + self-test               | Existing membership validator                   | Prevents a new check from existing but never executing.                           |
| Build and complete validation                                                    | System                                           | Server build and `validate:all`                 | Detects cross-contract integration failures.                                      |
| Actual contributor flow                                                          | Live drive                                       | Catalog write→check and isolated scaffold       | Proves commands work as a user invokes them, beyond planted fixtures.             |

### Done criteria

| Criterion                                       | Validation                                     | Pass condition                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| One authored project-guidance source set        | Generator + content audit                      | Only CLAUDE and scoped rules are authored; AGENTS carries the generator marker and matches expected bytes.               |
| Compatibility entrypoint is reproducible        | Working-tree/index render + Git classification | Projection is below 32 KiB, byte-identical from equivalent inputs, marked generated, and retained as a regular artifact. |
| Descriptor corpus is complete                   | Real descriptor validation                     | All 36 boundaries validate; zero missing/unexpected descriptors.                                                         |
| Lifecycle constraints are meaningful            | Self-test                                      | Invalid replacement/removal cases fail with descriptor ids and paths.                                                    |
| Import facts are structured                     | Architecture real run                          | Valid JSON, ≥400 modules, nonzero dependencies, error rules fail.                                                        |
| No policy duplication                           | Code review + searches                         | Descriptors contain no allowed-dependency lists; config remains sole rule source.                                        |
| Catalog is deterministic and current            | Write twice + `--check`                        | Second write is byte-identical; check passes; every id appears once.                                                     |
| Scaffold is guarded                             | Isolated live drive                            | Valid creation succeeds; overwrite and unguarded path fail without partial output.                                       |
| All routes enforce intended checks              | Membership + docs simulation                   | Full suite and docs-only paths each invoke their applicable invariant.                                                   |
| Old paths are removed                           | Targeted search                                | No `validate-arch.js` consumer or copied AGENTS instruction body remains.                                                |
| Documentation no longer inventories stale paths | Search + link resolution                       | Removed paths are absent; catalog links resolve.                                                                         |
| Repository remains healthy                      | Build + targeted + full suite                  | All implementation-caused failures resolved and full suite passes.                                                       |
| Migration closes in one delivery                | Diff audit                                     | No legacy wrapper, copied instruction file, temporary flag, or duplicate generated view survives.                        |

### Documentation

| Document                           | Update needed                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                        | Canonical-source marker, audited unique current guidance, symlink/platform note, stable descriptor/catalog pointers. |
| `AGENTS.md`                        | No authored content; deterministic generated projection only.                                                        |
| `docs/reference/module-catalog.md` | New generated table and collapsed graph.                                                                             |
| `docs/README.md`                   | Register the catalog in the reference map.                                                                           |
| `docs/architecture/overview.md`    | Replace stale tree and invalid paths with stable layer responsibilities and generated-catalog link.                  |
| `CHANGELOG.md`                     | Added entry when implementation lands.                                                                               |
| This plan                          | Row status/evidence updates only during execution; rulings/deviations go to sibling notes.                           |

### Risks and rollback

| Risk                                         | Impact                                       | Mitigation                                                                                     | Rollback                                                                              |
| -------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Generated projection exceeds a client budget | Later guidance is truncated or ignored       | Enforce 32 KiB, project selected decision-bearing sections, and dispatch scoped rules by path. | Reduce projected sections while keeping canonical sources intact.                     |
| AGENTS audit drops a valid rule              | Agent behavior regresses                     | Semantic diff and explicit current/stale classification before replacement.                    | Restore omitted rule to CLAUDE; never restore a second maintained body.               |
| Descriptor coverage becomes bureaucratic     | Contributors add low-value metadata          | Bound recursion with `children`; default domains to internal.                                  | Relax the parent child policy; do not disable schema validation globally.             |
| Catalog is mistaken for permission policy    | Readers infer observed edges are allowed     | Label observed graph clearly and link `.dependency-cruiser.cjs` as enforcement source.         | Remove dependency columns/graph while retaining descriptors and validation.           |
| dependency-cruiser JSON shape changes        | Validation and generation fail closed        | Parse a narrow versioned internal contract; self-test malformed/missing fields.                | Pin the existing compatible release or adapt the single graph adapter.                |
| Two cruises lengthen validation              | Developer feedback slows                     | Record timings; optimize only after measurement.                                               | Run one generated JSON artifact through both consumers in a later measured change.    |
| Scaffold partially creates files             | Dirty or misleading module boundary          | Validate inputs and parent policy first; atomic/cleanup behavior in integration tests.         | Delete isolated partial output; validator blocks merging incomplete corpus.           |
| Generated catalog causes noisy diffs         | Reviews obscure semantic changes             | Stable sort, no timestamp, collapsed boundaries.                                               | Regenerate from canonical inputs; revert generator and artifact together if unusable. |
| Existing runtime/cli-shared debt is hidden   | Diagram overstates architectural cleanliness | Show observed edges and document non-goals; add no exemptions.                                 | Remove misleading role prose and open a focused relocation plan.                      |

### Release

```yaml
commit_convention: "feat(architecture): add semantic module governance"
scope: architecture
```

### Growth capture

- [x] Evaluate “local semantic metadata + generated volatile views” for `/knowledge-capture` after implementation evidence exists. — Evaluated 2026-08-23: one project-level sighting, below the three-sighting promotion threshold. Captured in the sibling notes' Growth Capture section and in the descriptor/catalog documentation rather than as a global rule.
- [x] Record the owner’s final symlink and descriptor-scope preferences in project memory if they recur outside this repository. — Not recurred outside this repository as of 2026-08-23; ruling R1 (projection over symlink) and R4 (boundary-scoped lifecycle) are recorded in the sibling notes. Revives if a second repository needs the same projection decision.
- [x] Update a skill only if execution reveals a reusable correction to planning, validation routing, or dependency-graph generation. — No skill changed. The eight deviations were plan-premise drift specific to this delivery, not reusable corrections to the planning or routing method.
- [x] Log any user correction immediately in the observations ledger. — Logged: `~/.claude/observations.jsonl` carries the 2026-08-20 symlink convention entry and its 2026-08-23 supersession by the generated-projection ruling.

### Final validation sequence

```bash
node scripts/sync-project-guidance.js --self-test
npm run guidance:check

npm --prefix server run validate:module-descriptors:self-test
npm --prefix server run validate:module-descriptors
npm --prefix server run validate:arch:self-test
npm --prefix server run validate:arch
npm --prefix server run generate:module-catalog -- --self-test
npm --prefix server run generate:module-catalog
npm --prefix server run generate:module-catalog -- --check
npm --prefix server run scaffold:module -- --self-test
npm --prefix server run validate:suite-membership:self-test
npm --prefix server run validate:suite-membership

npm --prefix server run typecheck
npm --prefix server run lint:ratchet
npm --prefix server run typecheck:tests:ratchet
npm --prefix server run test:ci
npm --prefix server run build
npm --prefix server run validate:all

git diff --check
git status --short
```

### Completion report contract

The implementation report must include:

1. Canonical-source and symlink evidence, including Git mode.
2. Descriptor count and catalog boundary/edge counts.
3. Dependency-cruiser module/dependency counts and any warnings retained.
4. Validation commands with pass/fail and measured duration for architecture/catalog/full suite.
5. Exact legacy artifacts removed.
6. Any skipped validation with impact.
7. Remaining runtime/cli-shared debt as a separate, non-blocking follow-up.
8. Working-tree status and generated-file drift status.
