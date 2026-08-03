# Renovate Maintenance Remediation — Implementation Notes

## Status

- **Lifecycle:** `migrating`
- **Current milestone:** Phase 5 safe reconciliation complete; Phase 6 hosted rollout pending
- **Baseline:** `main` at `2ddd763f` when Phase 1 started
- **Phase 2 validation baseline:** `main` at `905c9261`
- **Phase 3 validation baseline:** `main` at `b41adc43`
- **Phase 4 validation baseline:** `main` at `d4a5360f`
- **Concurrent work:** another session owns the existing server, test, and unrelated plan diffs

## Intent

Repair the dependency-policy boundary first: Renovate extraction, semantic release
classification, grouping, labels, schedules, and Python-tool ownership should resolve
to one reviewable policy before packaging and hosted enforcement are changed.

## Phase 1 Evidence

### Configuration decisions

- `config:recommended` remains the base preset.
- Targeted additions: config migration, GitHub Action digest pinning, abandonment
  detection, preserved SemVer ranges, and weekly lock maintenance.
- An explicit catch-all package rule restores `chore(deps)` after
  `config:recommended` applies its dependency-specific semantic rules.
- A later, narrower rule maps only `server/package.json` runtime dependencies to
  `fix(deps)`.
- Repository labels are `dependencies` plus additive `security` and
  `vulnerability` labels for vulnerability-alert PRs.
- Regular updates and lock maintenance use `* 0-5 * * 1` in UTC; vulnerability
  alerts retain immediate creation and manual merge.
- Unrelated major updates resolve without a group; TypeScript and MCP SDK retain
  explicit manual-review groups.
- Ruff, Pyrefly, Renovate, GitHub Actions, testing tools, and linting tools have
  bounded ownership rules.
- The TypeScript 7 PR notes were preserved verbatim.

### Local validation

| Check                                 | Result                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `renovate@44.6.0` strict validator    | pass; no configuration warnings                                          |
| Local extract with `GITHUB_COM_TOKEN` | pass; 14 package files and 114 dependencies                              |
| npm extraction                        | 3 manifests; root and server lock domains detected                       |
| regex extraction                      | Ruff, Pyrefly, and Renovate each detected once                           |
| nodenv extraction                     | `.node-version` detected once at Node 24                                 |
| Action extraction                     | 7 external-Action package files, 61 references                           |
| Resolved-rule samples                 | server runtime=`fix`; audited maintenance classes=`chore`; automerge off |
| Repository label comparison           | `dependencies`, `security`, and `vulnerability` exist                    |

Resolved sample groups:

| Sample                 | Semantic type | Group                       |
| ---------------------- | ------------- | --------------------------- |
| server `express` minor | `fix`         | Server runtime dependencies |
| root `graphviz` patch  | `chore`       | ungrouped                   |
| TypeScript major       | `chore`       | TypeScript                  |
| unrelated dev major    | `chore`       | ungrouped                   |
| MCP SDK minor          | `fix`         | MCP SDK                     |
| Ruff patch             | `chore`       | Python validation tools     |
| Action digest          | `chore`       | GitHub Actions              |

Server validation ran in an isolated clone at committed `094baec6` with the two
Phase 1 `.github` files overlaid. This avoided reading the concurrent session's
uncommitted source as Tier 1 evidence.

| Server/repository check                | Result                                                             |
| -------------------------------------- | ------------------------------------------------------------------ |
| CI workflow YAML parse                 | pass                                                               |
| scoped `git diff --check` and Prettier | pass                                                               |
| `npm run typecheck`                    | pass                                                               |
| `npm run lint:ratchet`                 | pass; 3,459 errors and 1,407 warnings, no regression               |
| `npm test`                             | pass; 146 suites and 1,743 tests                                   |
| `npm run test:ci`                      | pass; 146 suites and 1,743 tests                                   |
| `npm run validate:all`                 | pass; existing `ulid` extension-classification warning recorded    |
| `npm run lint`                         | fails on existing repository debt: 3,478 errors and 1,407 warnings |

The full-lint failure is reported separately as required by the repository workflow;
Tier 1 changed no linted server source, and the ratchet plus targeted gates passed.

## Phase 2 Evidence

### Canonical ownership and enforcement

- Root `package.json` now owns exact `@anthropic-ai/mcpb@2.1.2`; the root lock
  added 45 MCPB/transitive entries, removed none, and changed no existing entry.
- The server MCPB validation script delegates to the root executable. The old
  unpinned `npx` path is removed.
- Renovate's workflow installs exact `renovate@44.6.0`, runs strict validation,
  captures local extraction JSONL, and sends it through a fail-closed validator.
- Workflow path filters cover the config, manifests, both lock domains,
  `.node-version`, all Action/workflow files, `server/.npmrc`, and the validator.
- The extraction validator rejects missing/non-JSON output, warning/error records,
  manager/file inventory drift, policy drift, and duplicate or misplaced MCPB
  ownership. Its utility remains below the 200-line project threshold.
- Extension packaging now installs the server's committed production lock in an
  isolated temporary root, copies that closure into staging, validates it, and uses
  the exact root MCPB binary through one workflow entrypoint.
- `chokidar` and `ulid` are explicit bundled exclusions. The validator proves both
  bundle markers exist, both top-level packages are absent from staging, every
  retained direct dependency exists in the lock and staged tree, and the staged
  manifest agrees with the server manifest.

### Local validation

Validation used an isolated clone at committed `905c9261` with only the Renovate
Phase 1/2 files overlaid. This prevents the parallel session's uncommitted server
work from becoming evidence for this tier.

| Check                                       | Result                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Root `npm ci`                               | pass; 413 packages                                                      |
| Server `npm ci`                             | pass; 837 packages                                                      |
| `renovate@44.6.0` strict validation         | pass; no config warning                                                 |
| Real local extraction validator             | pass; 14 files / 115 dependencies                                       |
| Extracted managers                          | Actions 7/61; nodenv 1/1; npm 3/50; regex 3/3                           |
| MCPB extraction                             | exactly once from root npm manifest at `2.1.2`                          |
| Both validator self-tests                   | pass; healthy and wrong lock/stage/exclusion/JSONL/policy cases covered |
| MCPB manifest validation                    | pass                                                                    |
| Two clean MCPB builds                       | pass; 16,319-file inventories and locked dependency trees equal         |
| Staged dependency contract                  | 13 retained direct dependencies; `chokidar`/`ulid` absent               |
| Server typecheck                            | pass                                                                    |
| Server lint ratchet                         | pass; 3,454 errors / 1,407 warnings, no regression                      |
| Server unit tests                           | pass; 146 suites / 1,743 tests                                          |
| Server `validate:all`                       | pass                                                                    |
| Changed-script ESLint + changed-file format | pass                                                                    |
| Workflow YAML + build-script syntax         | pass                                                                    |
| Full server ESLint                          | existing debt: 3,473 errors / 1,407 warnings; changed scripts clean     |

The two archives intentionally do not have equal byte hashes: the existing esbuild
configuration embeds `BUILD_TIME`, and ZIP metadata is time-derived. The approved
reproducibility contract is equivalent locked dependency and file inventories; both
comparisons passed, including the staged `.package-lock.json`.

## Deviations

1. **Phase 0 clean-tree guard is not yet satisfied.** The user directed Tier 1 work
   on `main` while another session finishes. Phase 1 changes are limited to
   `.github/renovate.json5`, `.github/workflows/ci.yml`, and these notes; the
   concurrent session's files were not edited.
2. **The plan's five-file Action inventory is stale.** Measured extraction reports
   seven external-Action package files. In addition to the five listed in the plan,
   `.github/workflows/downstream-sync.yml` and `.github/workflows/npm-publish.yml`
   contain external mutable refs. Phase 3 must include both files before its pinning
   gate may pass.
3. **Local Renovate needs `GITHUB_COM_TOKEN` for warning-free Action extraction.**
   Phase 2's validator workflow should supply the standard GitHub token without
   logging it.
4. **Node 24.11.1 cannot load the `re2@1.26.1` engine-supported range without an
   engine warning.** Local strict validation used an isolated installation where
   RE2 loaded successfully; hosted validation should run on the repository's current
   Node 24 line and record the exact patch version.
5. **A locked-tree MCPB spike exposed npm binary links as part of the artifact
   contract.** Removing the intentionally bundled `ulid` package left
   `node_modules/.bin/ulid` dangling, and MCPB correctly rejected the archive.
   Phase 2 now removes dangling package binary links after applying exclusions and
   validates the resulting staged tree before packing.
6. **`server/package-lock.json` remained unchanged.** Phase 2 changes only server
   scripts; npm lock v3 does not persist the `scripts` object. Rewriting the lock
   would create unrelated churn, so validation proved the existing root dependency
   metadata and every required lock entry instead.
7. **The concurrent worktree is not a valid lint baseline.** Its in-progress server
   edits currently add one `import-x/order` error. The isolated `905c9261` overlay
   passes the committed lint ratchet; no concurrent source file was edited here.
8. **The sandbox's default npm cache is read-only.** The first root install failed
   with `EROFS`; all recorded clean-install evidence uses the same npm command with
   `npm_config_cache` pointed at `/tmp`. The isolated clone's Husky prepare step also
   completed normally because its Git metadata is writable.
9. **Full ESLint remains a nonblocking debt report under the repository's explicit
   ratchet policy.** The isolated Phase 2 overlay reports 3,473 errors and 1,407
   warnings across the repository. Both changed validators pass targeted ESLint, and
   the blocking source ratchet passes without regression.
10. **The planned `>=22.0.0` server floor was not executable as written.** The server
    imports `node:sqlite` without a launch flag. Node added that module in 22.5.0 and
    removed the `--experimental-sqlite` requirement in 22.13.0, so Phase 4 corrected
    the server manifest, lock root, MCPB manifest, CI minimum, and documentation to
    `>=22.13.0`. See the [Node.js SQLite history](https://nodejs.org/download/release/latest-v22.x/docs/api/sqlite.html).
11. **`.nvmrc` is not a canonical pin.** It was intentionally removed earlier because
    no machine consumer read it; `.node-version` is the sole Node 24 development and
    publish pin. Phase 4 corrected the stale completed TODO instead of recreating a
    second path.
12. **The first CLI validation invocation ran tests before producing `cli/dist/cpm.js`.**
    The integration suite correctly failed on the missing artifact. Re-running the
    CI order (typecheck → build → tests) passed, including build, tests, and help smoke
    under the declared Node 18.18.0 floor.
13. **The session-local `AGENTS.md` remains outside the release surface.** Git excludes
    it through `.git/info/exclude`, and its supplied Node 18–24/`.nvmrc` guidance is
    stale. The tracked operator handbook and contributor/runtime docs are canonical;
    the local agent-rule source should be regenerated separately rather than added to
    this Release Please change set.

## Legacy Removal Checkpoint

| Superseded artifact          | Phase 1 state | Evidence                                           |
| ---------------------------- | ------------- | -------------------------------------------------- |
| Global `chore(deps)` prefix  | `removed`     | resolved server/runtime and tooling samples        |
| Generic security patch group | `removed`     | vulnerability-alert object is immediate and manual |
| Nonexistent category labels  | `removed`     | config references only three live labels           |
| Monthly lock schedule        | `removed`     | resolved Monday six-hour schedule                  |
| Broad Python regex           | `removed`     | Ruff and Pyrefly each extract once                 |
| Broad global npm regex       | `removed`     | only the Renovate workflow line is matched         |
| MCPB workflow regex          | `removed`     | root npm manifest is the sole extraction path      |
| Unpinned MCPB `npx`          | `removed`     | server delegates to exact root MCPB                |
| Staged `npm install`         | `removed`     | temporary server lock + `npm ci --omit=dev`        |
| Advisory-only unknown deps   | `removed`     | classification and staged closure now fail closed  |

The configuration remains `migrating` until immutable Actions, runtime alignment,
live GitHub reconciliation, hosted Renovate evidence, and the bounded automerge
observation period are complete.

## Growth Capture

The audit plus Tier 1 implementation confirmed the compound pattern: dependency
automation is a delivery contract, not an isolated bot configuration. Future reviews
should trace extraction → effective rule merge → semantic release input → protected
checks → published artifact, and should measure every dependency source rather than
rely on a previously counted file inventory.

Phase 2 added a second compound learning: reproducible packaging begins with a
committed resolution graph, but exclusions also have consequences in generated
binary links, staged manifests, and archive traversal. A dependency exclusion is not
complete until the bundle, lock, staged tree, and packer all agree.

Phase 4 added a third: a runtime floor should be derived from the first release where
every directly used platform API works under the actual launch flags, not from the
major release label. Packaging metadata, executable engines, CI minima, and public
support tables are consumers of that single measured boundary; the self-contained
CLI remains a separate compatibility surface.

## Phase 3 Evidence

### Immutable Action boundary

GitHub documents a full-length commit SHA as the immutable Action reference. Each
existing major tag was resolved through the upstream repository's Git data, and the
exact release tag in the same-line comment was independently resolved to the same
commit:

| Action release                            | Verified upstream commit                   |
| ----------------------------------------- | ------------------------------------------ |
| `actions/checkout@v7.0.1`                 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node@v7.0.0`               | `820762786026740c76f36085b0efc47a31fe5020` |
| `actions/upload-artifact@v7.0.1`          | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| `actions/download-artifact@v8.0.1`        | `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` |
| `actions/github-script@v9.0.0`            | `3a2844b7e9c422d3c10d287c895573f7108da1b3` |
| `googleapis/release-please-action@v5.0.0` | `45996ed1f6d02564a971a2fa1b5860e934307cf7` |
| `peter-evans/create-pull-request@v8.1.1`  | `5f6978faf089d4d20b00c7766989d076bb2fc7f1` |
| `softprops/action-gh-release@v3.0.2`      | `3d0d9888cb7fd7b750713d6e236d1fcb99157228` |

- All 41 external references across the composite action and six workflows now use
  those 40-character lowercase commits with exact release comments.
- `validate-github-action-pins.js` is a stateless, 96-line filesystem policy
  validator. It rejects mutable refs, uppercase or short SHAs, absent/unreadable
  release comments, and malformed `uses:` lines while allowing repository-local
  actions.
- The validator and its self-test are part of `validate:all`. Mutable and malformed
  negative fixtures are required to fail.
- Renovate extraction still finds seven external-Action package files and reports all
  41 Action dependencies with `currentDigest` set to a full SHA. The digest helper
  remains responsible for maintainable future updates.

### Local validation

Validation used an isolated clone at committed `b41adc43` with only the Renovate
Phase 1–3 files overlaid.

| Check                             | Result                                                             |
| --------------------------------- | ------------------------------------------------------------------ |
| Upstream release-tag dereference  | pass; 8/8 comments resolve to their pinned commits                 |
| Action pin repository scan        | pass; 41 refs / 10 YAML files                                      |
| Action pin validator self-test    | pass; healthy, mutable, uppercase, commentless, malformed cases    |
| Mutable external `@vN` search     | pass; zero matches                                                 |
| YAML parse                        | pass; composite action plus six workflows                          |
| Renovate strict + real extraction | pass; all 41 Action dependencies digest-pinned                     |
| Changed-file ESLint + Prettier    | pass                                                               |
| Server typecheck                  | pass                                                               |
| Server lint ratchet               | pass; 3,454 errors / 1,407 warnings, no regression                 |
| Server unit tests                 | pass; 145 suites / 1,754 tests                                     |
| Server `validate:all`             | pass                                                               |
| Full server ESLint                | existing debt: 3,473 errors / 1,407 warnings; changed script clean |

Hosted workflow execution is not yet evidence because `autonomous_commit:false` and
the user is accumulating tiers on `main`. The seven YAML files must pass on the
eventual PR before Phase 5 may enable repository full-SHA enforcement.

### Phase 3 Removal Checkpoint

| Superseded artifact                 | State       | Evidence                                   |
| ----------------------------------- | ----------- | ------------------------------------------ |
| External mutable major Action refs  | `removed`   | zero external `uses:` refs with `@vN`      |
| Manual-only Action pin review       | `removed`   | repository scan and negative self-test     |
| Unverified pin provenance           | `removed`   | eight upstream release tags dereferenced   |
| Repository full-SHA policy disabled | `migrating` | enable only after hosted workflow evidence |

The code path for Action pinning is locally canonical. Live enforcement remains
`migrating` until the eventual PR passes and Phase 5 applies the repository policy.

## Phase 4 Evidence

### Runtime boundary

- Server executable, lock-root, and packaged metadata now agree on Node.js
  `>=22.13.0`; CI proves that exact minimum plus the Node 24 shipping line.
- The standalone CPM CLI remains a distinct Node.js `>=18.18.0` surface.
- `.node-version` remains the sole Node 24 local-development and publish pin.
- The tracked operator handbook, contributor guide, server README, deployment
  prerequisite, design decision, completed TODO, and current changelog entry now
  project those same boundaries.
- A tracked-file stale-claim scan found no remaining Node 18 server claim, broad
  Node 22 minimum, Node 18→24 server matrix, or `.nvmrc` policy reference. The
  `.gitattributes` entry for the possible filename is metadata, not a support claim.

### Local validation

Validation used an isolated clone at committed `d4a5360f` with only the Renovate
Phase 1–4 files overlaid, so the other session's uncommitted server work did not
become Phase 4 evidence.

| Check                                          | Result                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Root and server clean installs                 | pass; committed root/server resolution graphs                                        |
| MCPB manifest schema                           | pass                                                                                 |
| Server build and extension dependency contract | pass                                                                                 |
| Server typecheck                               | pass                                                                                 |
| Server lint ratchet                            | pass; 3,454 errors / 1,407 warnings, no regression                                   |
| Server unit tests                              | pass; 145 suites / 1,754 tests                                                       |
| Server `validate:all`                          | pass, including format, architecture, contracts, manifests, and validator self-tests |
| Node 22.13.0 server startup                    | pass; all startup phases completed                                                   |
| Node 24 CLI typecheck, build, and tests        | pass; 3 suites / 75 tests                                                            |
| Node 18.18.0 CLI build, tests, and help smoke  | pass; 3 suites / 75 tests                                                            |
| Full server ESLint                             | existing debt: 3,473 errors / 1,407 warnings; ratchet remains the blocking policy    |

Hosted matrix runs remain pending because the accumulated tiers are intentionally
uncommitted. The eventual PR must pass both `Test (Node 22.13.0)` and `Test (Node 24)`
before this support boundary is release evidence.

### Phase 4 Removal Checkpoint

| Superseded artifact                        | State     | Evidence                                               |
| ------------------------------------------ | --------- | ------------------------------------------------------ |
| Node 18 packaged-server claim              | `removed` | manifest and public server docs use >=22.13.0          |
| Imprecise >=22.0.0 executable floor        | `removed` | server manifest/lock and exact-minimum startup agree   |
| Node 18→24 server CI claim                 | `removed` | exact server matrix is 22.13.0 plus 24                 |
| `.nvmrc` dual-pin guidance                 | `removed` | tracked policy names `.node-version` only              |
| Collapsed server/CLI compatibility surface | `removed` | support tables and exact-line validation split the two |

The runtime-support path is locally canonical. Hosted workflow proof remains a PR
exit criterion rather than a parallel implementation.

## Phase 5 Evidence

### Ingestion and pre-flight

- **Tier:** five items were initially combined. The three safe reconciliation items
  remain Phase 5; the two commit-dependent hosted mutations moved to Phase 6 so no
  external wait is hidden inside this tier's gate.
- **Execution order:** 5.1 required-context foundation → 5.2 branch protection;
  5.3 labels/security was an independent audit. Full-SHA activation and Renovate App
  evidence now execute after an isolated implementation PR in Phase 6.
- **Work type:** configuration/external integration; secondary type security policy;
  risk high because an incorrect required context or premature SHA policy could block
  every workflow or merge.
- **Files:** one existing JSON SSOT plus plan/evidence updates. No new source, test,
  external library, API surface, visual design, or persistent application state.

### Repository SSOT and live settings

- `.github/required-contexts.json` now pipes `{strict:true, contexts:[...]}` JSON to
  the branch-protection endpoint instead of piping four plain-text lines to an API
  that expects an object.
- The required-context validator and its falsifiable self-test pass; all four names
  resolve to current workflow job names, and tracked root formatting passes.
- Before reconciliation, live protection was strict but required only `Lint &
Validate` and `Build`. Current `main` had recent successful check runs for those
  names plus `CLI` and `Test Suite`.
- The planned PATCH was applied. A read-back now returns `strict:true` and exactly
  `Lint & Validate`, `Build`, `CLI`, and `Test Suite`, each bound to the GitHub Actions
  app.
- Labels `dependencies`, `security`, and `vulnerability` already exist; no label was
  created.
- Vulnerability alerts are enabled (HTTP 204 probe). Automated security fixes report
  `{enabled:false, paused:false}`, matching the policy that Renovate owns regular
  dependency PRs while alerts remain available.

### Guarded stop before Actions and Renovate mutation

- Repository Actions currently report `{enabled:true, allowed_actions:"all",
sha_pinning_required:false}`.
- Remote `main` still contains mutable refs such as `actions/checkout@v7`,
  `actions/setup-node@v7`, and artifact Actions by major tag. The locally pinned
  workflows have not been committed or exercised by GitHub.
- Enabling `sha_pinning_required` now would reject current remote workflows before
  their pinned replacements have hosted evidence. Phase 6.3 therefore remains
  `migrating`; the live policy was intentionally left unchanged.
- No Renovate PR is currently open. Dashboard issue #157 reflects the pre-remediation
  configuration (including a production group titled `chore(deps)`), so it cannot
  prove the new semantic types, groups, extraction contract, or required checks.
  Triggering Renovate before the configuration is committed would test the wrong
  policy; Phase 6.5 remains pending.

### Phase 5 checkpoint

| Item                         | State       | Evidence / next guard                                  |
| ---------------------------- | ----------- | ------------------------------------------------------ |
| 5.1 required-context SSOT    | `canonical` | validator, self-test, and JSON shape pass              |
| 5.2 branch protection        | `canonical` | strict read-back contains exactly four contexts        |
| 5.3 labels/security          | `canonical` | three labels present; alerts on; security fixes off    |
| 6.3 full-SHA Actions policy  | `migrating` | isolated PR → hosted workflows pass → enable → rerun   |
| 6.5 hosted Renovate evidence | `migrating` | merge config → trigger app → inspect representative PR |

The re-scoped Phase 5 gate is satisfied: tracked and live safe settings agree without
enabling a policy current remote workflows cannot meet. Phase 6 owns the isolated
commit/PR, hosted evidence, policy activation, landing audit, and Renovate run. Local
tier-wide suites are not reclassified as hosted evidence because they cannot satisfy
those guards.

## Phase 6 Evidence

### Isolation and landing guard

- The shared `main` worktree had extensive concurrent source/test renames and edits,
  plus 16 committed changes not yet present on GitHub. Phase 6 did not switch its
  branch, stage its index, stash, reset, clean, or copy any unrelated dirty file.
- A no-hardlink clone at `/tmp/renovate-rollout-Hj45Vn/repo` was created from local
  commit `467ee5a45bb0d4293907f8267258bae1900b26b4` on branch
  `fix/renovate-delivery-contract`. Only the 28 enumerated Phase 1–6 files were
  overlaid.
- GitHub `main` initially remained at `0b17526640614d14328dc76b61023fa63b3358f5`
  and did not contain the isolated branch base. The guard held: no mixed PR was
  opened. Prerequisite PR #174 landed the 17 finalized commits through `bd8095a7`
  first, after all protected checks passed, so the Renovate branch could be replayed
  from synchronized `main` as exactly one commit.

### Pre-PR local validation

| Check                                                                        | Result                                                                        |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Root and server clean installs                                               | pass; committed lock domains                                                  |
| Server typecheck                                                             | pass                                                                          |
| Server lint ratchet                                                          | pass; 3,437 errors / 1,405 warnings, no regression                            |
| Test typecheck ratchet                                                       | pass; 395 recorded test errors, no regression                                 |
| Server unit tests                                                            | pass; 145 suites / 1,754 tests                                                |
| Server `validate:all`                                                        | pass                                                                          |
| Required-context and Action-pin validators/self-tests                        | pass; four contexts and 41 pinned refs                                        |
| Renovate 44.6.0 strict validation                                            | pass under Node 24.15.0                                                       |
| Real Renovate extraction/policy contract                                     | pass                                                                          |
| MCPB schema, locked build, staged dependency contract, and packed validation | pass; 16,319 files                                                            |
| Full server ESLint                                                           | existing debt: 3,456 errors / 1,405 warnings; ratchet remains blocking policy |

The local Node 24.11.1 pin cannot install Renovate's optional `re2@1.26.1`, whose
published engine range now starts at Node 24.15.0 on the Node 24 line. A first strict
validation attempt therefore failed closed on Renovate's RE2 fallback warning. The
recorded strict/extraction evidence used Node 24.15.0, where RE2 installed and loaded;
the hosted workflow's floating Node 24 pin must report its exact patch version.

### Hosted rollout and policy activation

- PR #177 replayed the validated Renovate change onto synchronized GitHub `main` as
  commit `a5f152c0`: one commit, 28 files, and no concurrent-session work.
- Before policy activation, both Renovate validation events and the full CI chain
  passed, including `Lint & Validate`, `Build`, `CLI`, and `Test Suite`.
- Repository Actions permissions preserved `enabled:true` and `allowed_actions:"all"`.
  Only `sha_pinning_required` changed from false to true. The same PR runs were rerun
  and passed with the policy enabled; the final read-back remains true.
- PR #177 merged as `6ac5e873` only after its base, head, 28-file inventory, one-commit
  count, and four protected contexts were rechecked. Post-merge CI, Renovate validation,
  and Release Please all passed on `main`.

### Hosted defect and corrective loop

- The post-merge dashboard refreshed from the new policy: its header names the Monday
  00:00-05:59 UTC window, server runtime updates use `fix(deps)`, Python validation
  tools share `renovate/python-validation-tools`, all 41 external Action references
  retain version metadata plus full digests, and the server Node constraint is
  `>=22.13.0`.
- The first representative PR #178 had the expected `chore(deps)` title,
  `dependencies` label, grouped branch, stability status, and protected CI. Its two
  Renovate validation runs failed because the new validator incorrectly included the
  mutable `currentValue` in the custom-manager identity allowlist.
- Corrective PR #179 changed identity to stable package-file + dependency-name pairs,
  retained malformed-value rejection, and added a valid-version-update regression
  fixture. Its two Renovate validations, four protected contexts, and complete CI
  passed before merge as `927a816e`.
- Renovate rebased PR #178 onto the corrective main. Both Renovate validation events,
  `Lint & Validate`, `Build`, `CLI`, `Test Suite`, both Node matrix legs, PR Summary,
  and `renovate/stability-days` now pass. The PR remains open and manual because
  Phase 7 owns observation and any eventual automerge decision.

### Phase 6 checkpoint

| Item                           | State       | Evidence                                                                  |
| ------------------------------ | ----------- | ------------------------------------------------------------------------- |
| 6.1 isolated implementation PR | `canonical` | PR #174 synchronized the base; PR #177 contained one commit and 28 files  |
| 6.2 hosted pre-policy evidence | `canonical` | affected workflows and all four protected contexts passed                 |
| 6.3 full-SHA Actions policy    | `canonical` | policy read-back is true and the same PR workflow reruns passed           |
| 6.4 protected PR landing       | `canonical` | PR #177 merged as `6ac5e873`; post-merge main checks passed               |
| 6.5 hosted Renovate evidence   | `canonical` | dashboard refreshed; corrected representative PR #178 has all checks pass |

The Phase 6 gate is satisfied. Phase 7 may observe PR #178 and a second qualifying
Renovate cycle; no automerge behavior was enabled during rollout.

## Phase 7 Decision

### Deviation: accelerated bounded automerge

- On 2026-08-02 the maintainer explicitly waived the second weekly observation cycle.
  Prior Dependabot operation was supporting context, not treated as proof of Renovate
  rule matching.
- Renovate-specific evidence remains Phase 6's hosted dashboard, corrected extraction
  contract, and representative PR #178 reporting all four protected checks plus
  `renovate/stability-days` successfully.
- The compensating controls are a narrow eligible set, a 14-day release age,
  Renovate-controlled PR automerge, strict up-to-date branch protection, and durable manual-review
  exclusions for production, majors, 0.x packages, Actions, TypeScript, MCP SDK,
  testing/lint tooling, Python validation tools, and vulnerabilities.
- The implementation and its validation-routing changes ship in one protected PR;
  no plan-only PR is created.

### Phase 7 local implementation evidence

- `platformAutomerge` is disabled, while global `automerge:false` remains the default.
  One earlier rule admits stable, nonmajor development updates after 14 days; later
  rules explicitly restore manual review for production, majors, TypeScript, MCP SDK,
  testing/linting/build/packaging/hook tools, Actions, and Python validation tools.
- Weekly lock maintenance is eligible for automerge. Vulnerability alerts remain
  immediate and manual.
- Renovate 44.6.0 strict validation and real local extraction passed under Node 24.15.0.
  The extraction contract now asserts the eligible rule, every durable exclusion,
  Renovate-controlled PR mode, lock maintenance, and five pinned workflow Python tools.
- The validation-routing audit surfaced a previously hidden environment dependency:
  hook tests imported PyYAML but CI did not install it, and `validate:python` did not run
  the 178-test hook suite. Pytest 9.1.1 and PyYAML 6.0.3 are now pinned, Renovate-owned,
  and part of that gate; a clean Python 3.10 environment passed all 178 tests.
- Phase 7 remains `migrating` until the implementation PR reports the four protected
  contexts and hosted Renovate confirms the bounded rule on an eligible PR.

### Hosted canary failure and corrective guard

- The first post-merge lock-maintenance canary, PR #186, reported all four protected
  contexts as successful while `renovate/stability-days` remained pending.
- GitHub native auto-merge nevertheless merged PR #186 as `ccce9d9b` on 2026-08-03.
  The stability status was not a protected required context, so GitHub did not treat
  it as a merge gate. Requiring it globally is not viable because non-Renovate PRs do
  not report that context.
- **Diagnosis:** platform-owned automerge and Renovate-owned release-age policy were
  split across two decision makers. The protected checks proved functional validity,
  but did not prove the configured soak had elapsed.
- **Correction:** `platformAutomerge:false` makes Renovate the sole merge decision
  owner for eligible PRs, allowing it to observe both protected CI and its internal
  age check. The extraction validator rejects any future re-enable of platform
  automerge.
- The lock refresh merged through the failed guard is reverted in the same protected
  correction PR. It may be regenerated and merged later after the configured guard
  actually passes.

### Maintainer correction: defer TypeScript 7

- On 2026-08-03 Renovate opened PR #189 for TypeScript 7.0.2. Its protected lint,
  CLI, build, and aggregate test contexts failed before the test matrix could run.
- Current upstream contracts still block the migration: ts-jest 29.4.12 declares
  TypeScript `>=4.3 <7`, while typescript-eslint 8.65.0 declares `>=4.8.4 <6.1.0`.
- The TypeScript rule now carries `allowedVersions:"<7.0.0"`, so Renovate may still
  propose 6.x updates but must not recreate a 7.x PR. Delete the hold only after both
  peer ranges admit 7 and `validate:arch` proves a non-zero module graph under 7.
- PR #189 was closed after recording the hold. ts-morph 28 was not included: its
  upstream release explicitly targets TypeScript 6.0, so PR #188 remains a separate
  manual-review update rather than being misclassified as part of the TypeScript 7
  migration.
