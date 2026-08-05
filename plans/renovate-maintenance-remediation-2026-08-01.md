---
title: "Renovate and Dependency-Maintenance Remediation Plan"
date: 2026-08-01
status: active
tags: []
---

# Renovate and Dependency-Maintenance Remediation Plan

**Status:** in progress  
**Lifecycle:** current configuration = `migrating`; remediated configuration = `canonical` only after Phase 7  
**Baseline verified:** local `main` at `2ddd763f` on 2026-08-01  
**Owner:** repository maintainer  
**Risk:** high — merge protection, release triggering, dependency supply chain, and published artifacts

## 1. Intent Declaration

- **Work type:** `refactor`
- **Secondary type:** `bug_fix`
- **Confidence:** high
- **Problem:** dependency updates are discovered, classified, protected, released, and packaged by separate policies that currently disagree. A schema-valid Renovate PR may use a non-releasable commit type, bypass two intended checks, execute mutable Actions, miss pinned tools, or package dependencies resolved outside a committed lock.
- **Desired state:** one enforced path from dependency extraction through release and artifact validation, with narrowly bounded automation and documented runtime support.
- **Next phase before source edits:** `/refactoring` pre-flight.
- **External versions at plan time:** `renovate@44.6.0`, `@anthropic-ai/mcpb@2.1.2`.

### Acceptance criteria

1. Server production dependencies resolve to `fix(deps)`; development, Action, Python-tool, and root-tooling updates resolve to `chore(deps)`.
2. Extraction finds all three npm manifests, both lock domains, seven external-Action files, `.node-version`, Ruff, Pyrefly, Pytest, PyYAML, Renovate, and MCPB.
3. Every external Action reference is a verified 40-character commit SHA with a readable same-line version comment.
4. `main` requires exactly `Lint & Validate`, `CLI`, `Build`, and `Test Suite`.
5. Extension dependency versions come from a committed lock and two clean builds produce equivalent unpacked dependency/file inventories.
6. Server runtime metadata states Node >=22.13.0; CLI remains >=18.18; local and publish tooling use Node 24; server CI covers 22.13.0 and 24.
7. The obsolete security rule, nonexistent labels, broad MCPB regex path, unpinned MCPB invocation, unlocked staging install, monthly lock schedule, and conflicting range strategy are removed.
8. Limited automerge is enabled after hosted Phase 6 evidence and an explicit maintainer risk decision; it excludes 0.x, production, major, Action, TypeScript, MCP SDK, vulnerability, and critical-tool updates.

## 2. Context and Evidence

### Compound diagnosis: policy-to-delivery contract drift

```text
manifest/tool version
  -> Renovate extraction and rule merge
  -> PR semantic type, labels, group, and checks
  -> main branch protection
  -> Release Please
  -> npm and MCPB artifacts
```

The individual mechanisms exist, but the contract between them is incomplete:

| Severity | Evidence                                                                                               | Consequence                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Critical | `.github/renovate.json5:35` applies `chore(deps)` globally; `release-please-config.json` hides `chore` | Bundled production dependency updates may merge without creating a server patch release. |
| High     | `.github/required-contexts.json:17` declares four checks; live protection was observed with only two   | A dependency PR can merge without CLI or test-matrix evidence.                           |
| High     | Seven workflow/composite files use mutable major Action tags                                           | A moved tag can change executable CI code without a repository diff.                     |
| High     | `.github/workflows/ci.yml:69` installs Ruff and Pyrefly on one line; extraction observed only Ruff     | Pyrefly can age without an update PR.                                                    |
| High     | `scripts/build-extension.sh:77,83` uses unlocked `npm install` and unpinned `npx`                      | Rebuilding the same source may resolve a different dependency/tool graph.                |
| Medium   | Rule-level `labels` references many labels absent from the repository                                  | Labels may replace each other because Renovate documents `labels` as non-mergeable.      |
| Medium   | Broad major groups and stale lint package names overlap specific rules                                 | Unrelated breaking changes can share a PR; intended review rules may be obscured.        |
| Medium   | Duplicate presets and `rangeStrategy:auto` conflict with `:preserveSemverRanges`                       | Effective policy is harder to predict and review.                                        |
| Medium   | Three-hour weekly schedule and monthly lock maintenance                                                | Hosted execution timing can delay updates and lock convergence.                          |
| Medium   | `manifest.json`, `CONTRIBUTING.md`, `server/README.md`, and historical docs claim Node 18 support      | Operators can select a runtime below the server's `node:sqlite` floor.                   |

### Verified implementation surface

| Path                                                                         |                                           Verified symbol/line | Planned disposition                                        |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------: | ---------------------------------------------------------- |
| `.github/renovate.json5`                                                     | 247 lines; rules 45; alerts 180; locks 202; regex managers 227 | Edit; preserve TypeScript 7 notes.                         |
| `.github/required-contexts.json`                                             |                                                    contexts 17 | Retain four names; correct apply example.                  |
| `server/scripts/validate-required-contexts.js`                               |                                            `findViolations` 72 | Reuse unchanged unless validation integration requires it. |
| `.github/workflows/ci.yml`                                                   |                                  stable names 41, 97, 134, 247 | Split Python installs; pin Actions.                        |
| `.github/workflows/downstream-sync.yml`, `.github/workflows/npm-publish.yml` |                                           external Action refs | Pin Actions; include both in the Action-policy gate.       |
| `release-please-config.json`                                                 |                             release type 3; changelog types 11 | Reuse as release contract.                                 |
| `scripts/build-extension.sh`                                                 |                                            install 77; MCPB 83 | Replace both nondeterministic paths.                       |
| `server/scripts/validate-extension-deps.js`                                  |                                   required/excluded sets 24/42 | Extend existing validator.                                 |
| `.github/workflows/renovate-config-validator.yml`                            |                                           strict validation 34 | Add extraction validation.                                 |
| `package.json` / `package-lock.json`                                         |                                   dev dependencies 17; lock v3 | Own exact MCPB version.                                    |
| `server/package.json` / `server/package-lock.json`                           |                                   MCPB validation 125; lock v3 | Delegate to root tool; sync lock metadata.                 |
| `manifest.json`                                                              |                                            Node requirement 13 | Raise server runtime floor to 22.                          |
| `project-decisions.md`                                                       |                                        Node 22 rationale 19–29 | Reuse, do not duplicate.                                   |
| `AGENTS.md`                                                                  |                                   absent from tracked baseline | Do not edit or reference as a repository path.             |

## 3. Design Decisions

1. **Use a targeted preset set, not wholesale `config:best-practices`.** Keep `config:recommended` and add config migration, Action digest pinning, abandonment detection, preserved ranges, and weekly lock behavior explicitly. This avoids inheriting exact dev-dependency pinning and a second npm release-age policy.
2. **Treat semantic commit type as a release interface.** Default to `chore(deps)` and override server production dependencies to `fix(deps)`.
3. **Use a minimal real label vocabulary.** Top-level `dependencies`; additive `security` and `vulnerability` only. Review requirements belong in reviewer/rule behavior, not a large label taxonomy.
4. **Keep vulnerability changes immediate and manual.** Dependabot alerts remain enabled as a data source; Dependabot security PR creation remains disabled so Renovate is the sole remediation path.
5. **Isolate breaking changes.** Do not group unrelated majors. Give TypeScript, MCP SDK, testing, linting, Actions, and Python tools explicit boundaries.
6. **Pin Actions twice:** full SHA in source and an automated validator; Renovate's digest helper maintains the pins.
7. **Reuse the server lock for extension staging.** Copy the server manifest, lock, and `.npmrc` to a temporary install root, run `npm ci --omit=dev --ignore-scripts`, and then produce the filtered staged manifest. Do not create a second committed dependency manifest/lock.
8. **Make local extraction blocking while Renovate is pinned.** The local platform is documented as experimental, so a Renovate bump must update the parser and evidence atomically if output shape changes.
9. **Do not add npm `min-release-age` now.** Renovate remains the age gate. Reconsider only when every supported CI line uses a verified compatible npm and an emergency-exclusion procedure exists.
10. **Automerge follows evidence.** First deploy with automerge disabled; enable only stable nonmajor development and lock refreshes after hosted proof plus an explicit maintainer risk decision.

### Primary references

- Renovate best-practice preset contents: <https://docs.renovatebot.com/presets-config/>
- Renovate local extraction and limitations: <https://docs.renovatebot.com/modules/platform/local/>
- Mergeable `addLabels`: <https://docs.renovatebot.com/configuration-options/#addlabels>
- GitHub Action digest management: <https://docs.renovatebot.com/modules/manager/github-actions/>
- GitHub immutable Action guidance: <https://docs.github.com/en/actions/reference/security/secure-use>
- GitHub protected-branch API: <https://docs.github.com/en/rest/branches/branch-protection>
- Release Please conventional-commit behavior: <https://github.com/googleapis/release-please>
- npm release-age configuration: <https://docs.npmjs.com/cli/using-npm/config/#min-release-age>

## 4. Implementation Plan

### Phase 0 — Establish a reversible baseline

| #   | Target          | Change                                                                                                                 | Depends | Verification                                                            |
| --- | --------------- | ---------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| 0.1 | Git worktree    | Wait for the parallel session to finish; require clean `main`; record the new HEAD. Do not reset or stash its changes. | none    | `git branch --show-current && git status --short && git rev-parse HEAD` |
| 0.2 | GitHub settings | Capture labels, Dependabot settings, Actions policy, and branch protection JSON.                                       | 0.1     | `gh label list`; branch-protection and settings API output              |
| 0.3 | Upstream tools  | Reconfirm MCPB/Renovate versions and dereference each Action release tag to an upstream commit.                        | 0.1     | npm registry output and GitHub tag-object evidence                      |

**Gate:** clean-tree evidence, before-state GitHub JSON, and upstream provenance are recorded in implementation notes.

### Phase 1 — Repair Renovate policy

**Status:** complete locally on 2026-08-02; hosted evidence remains in Phase 6.

| #   | File                       | Change                                                                                                                                                   | Depends | Verification                                      |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------- |
| 1.1 | `.github/renovate.json5`   | Remove duplicate presets; add targeted migration, digest, abandonment, preserved-range, and weekly-lock behavior. Delete top-level `rangeStrategy:auto`. | Phase 0 | Strict validator and resolved-config review       |
| 1.2 | same                       | Delete global prefix; explicitly default to `chore(deps)` and override server production dependencies to `fix(deps)`.                                    | 1.1     | Extraction assertions for representative packages |
| 1.3 | same                       | Replace rule-level labels with top-level `dependencies` and additive security labels; delete references to nonexistent labels.                           | 1.1     | Compare configuration labels with `gh label list` |
| 1.4 | same                       | Delete the contradictory generic security/auto-merge rule; retain immediate manual vulnerability alerts and the 3-day strict regular-update age.         | 1.1     | Resolved alert policy                             |
| 1.5 | same                       | Rebuild bounded groups; isolate majors, TypeScript, and MCP SDK; update lint package names; preserve the TypeScript 7 notes verbatim.                    | 1.1     | Resolved groups from real extraction              |
| 1.6 | same                       | Use a six-hour Monday window, weekly lock maintenance, existing PR rate limits, and matching dashboard text. Keep automerge off.                         | 1.1     | Resolved schedules and dashboard output           |
| 1.7 | `.github/workflows/ci.yml` | Put Ruff and Pyrefly on separate exact-version install lines.                                                                                            | Phase 0 | Both tools run in `Lint & Validate`               |
| 1.8 | `.github/renovate.json5`   | Narrow the PyPI regex to the two exact line shapes. Preserve only narrowly scoped Renovate workflow matching until its ownership changes.                | 1.7     | Ruff and Pyrefly extracted exactly once           |

**Gate:** exact Renovate strict validation plus local extraction; no warning, missing manager, duplicate dependency, nonexistent label, or unexpected semantic type/group.

### Phase 2 — Enforce extraction and deterministic MCPB packaging

**Status:** complete locally on 2026-08-02; publication-workflow and hosted
Renovate evidence remain in Phase 6.

| #   | File                                                     | Change                                                                                                                                                                                                      | Depends       | Verification                                      |
| --- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------- |
| 2.1 | `server/scripts/validate-renovate-extraction.js` **new** | Parse pinned Renovate JSONL; assert manifest/lock managers, Action files, nodenv, Ruff, Pyrefly, Renovate, MCPB, representative groups, and semantic types. Include `--self-test`; reject empty extraction. | Phase 1       | Self-test plus real output                        |
| 2.2 | `.github/workflows/renovate-config-validator.yml`        | Trigger on every extraction source; install exact Renovate; run strict schema, local extraction, and assertions.                                                                                            | 2.1           | Local command parity and PR run                   |
| 2.3 | `package.json`, `package-lock.json`                      | Add exact MCPB as root dev dependency and root validation script; regenerate only root/workspace lock.                                                                                                      | Phase 0       | Root `npm ci`; MCPB validate; npm extraction      |
| 2.4 | `scripts/build-extension.sh`                             | Invoke root MCPB; replace staged `npm install` with `npm ci` in a temporary copy of server manifest/lock/`.npmrc`; copy the locked production tree; emit existing filtered runtime manifest.                | 2.3           | Two clean builds and inventory comparison         |
| 2.5 | `server/scripts/validate-extension-deps.js`              | Prove required dependencies exist in the server lock, exclusions are intentional bundles, and staged tree/manifest agree. Extend self-test.                                                                 | 2.4           | Extension validator and self-test                 |
| 2.6 | `server/package.json`, `server/package-lock.json`        | Delegate MCPB validation to root; register new validators in `validate:all`; sync lock root metadata without unrelated upgrades.                                                                            | 2.1, 2.3, 2.5 | Server `npm ci`; narrow lock diff; `validate:all` |
| 2.7 | `.github/workflows/extension-publish.yml`                | Ensure root `npm ci` precedes MCPB use and packaging has one entrypoint.                                                                                                                                    | 2.3–2.6       | Publication workflow and artifact validation      |
| 2.8 | `.github/renovate.json5`                                 | Delete MCPB/global-tool regex management superseded by the root manifest. Keep one Renovate dependency path.                                                                                                | 2.2, 2.3      | Exactly one extraction for each tool              |

**Gate:** root/server `npm ci`; strict/extract validation; extension dependency validation; two clean MCPB builds; server typecheck and lint ratchet.

### Phase 3 — Pin and enforce GitHub Actions

**Status:** complete locally on 2026-08-02; hosted workflow evidence requires the
isolated implementation PR before repository full-SHA enforcement in Phase 6.

| #   | File                                                                                      | Change                                                                                                                                                    | Depends | Verification                  |
| --- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------- |
| 3.1 | `.github/actions/setup-node-install/action.yml`                                           | Pin all setup-node calls to verified full SHAs with version comments.                                                                                     | Phase 0 | Provenance plus pin validator |
| 3.2 | `.github/workflows/ci.yml`                                                                | Pin checkout, setup-node, artifact, and github-script actions.                                                                                            | 1.7     | Four stable CI jobs pass      |
| 3.3 | `.github/workflows/extension-publish.yml`                                                 | Pin checkout, artifacts, releases, and PR creation actions.                                                                                               | 2.7     | Extension workflow passes     |
| 3.4 | `.github/workflows/downstream-sync.yml`, `.github/workflows/npm-publish.yml`              | Pin checkout and setup-node actions.                                                                                                                      | Phase 0 | Both workflows pass           |
| 3.5 | `.github/workflows/release-please.yml`, `.github/workflows/renovate-config-validator.yml` | Pin Release Please, checkout, and setup-node actions.                                                                                                     | 2.2     | Both workflows pass           |
| 3.6 | `server/scripts/validate-github-action-pins.js` **new**                                   | Reject non-local `uses:` refs unless they contain exactly 40 lowercase hexadecimal characters and a same-line version/ref comment. Include `--self-test`. | 3.1–3.5 | Self-test and repository scan |
| 3.7 | `server/package.json`                                                                     | Add the pin validator and its self-test to `validate:all`.                                                                                                | 3.6     | Server `validate:all`         |

**Gate:** pin validator passes; no external `@vN` refs remain; every affected workflow passes on a PR.

### Phase 4 — Align runtime documentation

**Status:** complete locally on 2026-08-02; the eventual PR must provide the
hosted Node 22.13.0 and 24 matrix evidence.

| #   | File                                                     | Change                                                                                                                                   | Depends    | Verification                         |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------ |
| 4.1 | `manifest.json`, server manifest and lock                | Set the packaged and executable server requirement to Node >=22.13.0, the first Node 22 release where `node:sqlite` is unflagged.        | Phase 2    | Manifest and MCPB validation         |
| 4.2 | `CLAUDE.md`, `CONTRIBUTING.md`                           | Add one support table: server >=22.13.0; server CI 22.13.0+24; CLI >=18.18; local/publish Node 24.                                       | 4.1        | Documentation search and review      |
| 4.3 | `server/README.md`, `docs/portfolio/design-decisions.md` | Update public server/runtime claims to >=22.13.0 and document the `node:sqlite` rationale.                                               | 4.1        | Repository-wide stale-version search |
| 4.4 | `docs/TODO.md`                                           | Correct completed pin and CI-policy entries, then separate server, CLI, and development support.                                         | 4.2        | Repository-wide stale-version search |
| 4.5 | Existing canonical files and CI                          | Verify `project-decisions.md`, `.node-version`, server/CLI engines, and CI; correct any support boundary the verification disproves.     | 4.2–4.4    | Targeted `rg` and matrix tests       |
| 4.6 | `CHANGELOG.md`                                           | Add an Unreleased Changed entry for dependency automation, packaging reproducibility, immutable Actions, checks, and support boundaries. | Phases 1–4 | Changelog review                     |

**Gate:** no stale Node support claim; manifest validation; server typecheck, lint ratchet, tests, and `validate:all`; CLI validation on supported CI lines.

### Phase 5 — Reconcile live GitHub settings

**Status:** complete on 2026-08-02. Repository policy and the safe live settings are
canonical; hosted activation is isolated in Phase 6 so this tier has no external wait
inside its gate.

| #   | Target                           | Change                                                                                                | Depends                                                | Verification               |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------- |
| 5.1 | `.github/required-contexts.json` | Correct the example to send `{strict:true,contexts:[...]}` JSON; retain the four names.               | Phase 3                                                | Required-context validator |
| 5.2 | Branch protection                | Apply the SSOT with `jq '{strict:true, contexts}' ...                                                 | gh api -X PATCH .../required_status_checks --input -`. | 5.1 and recent check runs  | GET returns exactly four contexts and strict mode |
| 5.3 | Labels/security                  | Verify the three labels; create only a missing one. Verify alerts on and Dependabot security PRs off. | Phase 1                                                | GitHub settings evidence   |

**Gate:** the tracked required-context SSOT, branch-protection read-back, labels, and
security settings match the repository policy without enabling a policy that current
remote workflows cannot satisfy.

### Phase 6 — Hosted rollout and full-SHA activation

**Status:** complete on 2026-08-02. Prerequisite PR #174 synchronized the finalized
local base before the one-commit, 28-file Renovate PR #177 landed. Full-SHA enforcement
is enabled and passed hosted reruns. Representative Renovate PR #178 now projects the
new grouping, label, schedule, extraction, and protected-check policy; corrective PR
#179 removed the validator false failure that PR #178 exposed.

| #   | Target                     | Change                                                                                                                                                             | Depends | Verification                                   |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ---------------------------------------------- |
| 6.1 | Isolated implementation PR | Create a tier-scoped branch from a synchronized remote `main`; apply and commit only the accumulated Renovate Phase 1–5 files.                                     | Phase 5 | PR diff contains no concurrent-session work    |
| 6.2 | Hosted pre-policy evidence | Run the PR before SHA enforcement; require all affected workflows, the four protected checks, Renovate validation, pin validation, and packaging validation.       | 6.1     | Hosted checks pass on the pinned PR head       |
| 6.3 | Actions policy             | Preserve `enabled` and `allowed_actions`, enable `sha_pinning_required`, then rerun the same PR workflows. Roll back the boolean immediately if a workflow fails.  | 6.2     | Policy GET is true and reruns pass             |
| 6.4 | PR landing                 | Merge only through the protected PR after confirming its merge base, changed-file inventory, approvals, and four required checks; verify `main` after the merge.   | 6.3     | Merge commit/tree contains only approved scope |
| 6.5 | Renovate App               | Trigger a Mend-hosted run after merge and inspect its job/dashboard/representative PR for semantic type, group, labels, schedule, extraction, and required checks. | 6.4     | Representative hosted PR and job-log evidence  |

**Gate:** the isolated PR lands without concurrent-session work; full-SHA policy is
enabled and its reruns pass; the committed Renovate policy produces representative
hosted evidence; a Renovate PR cannot merge until all four protected checks pass.

### Phase 7 — Bounded automerge and migration closeout

| #   | Target                   | Change                                                                                                                                               | Depends | Verification                                  |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------- |
| 7.1 | Observation ledger       | Record the Phase 6 hosted cycle and the maintainer's explicit decision to accelerate the second-cycle guard based on prior dependency-bot operation. | Phase 6 | Dated PR/check evidence plus deviation record |
| 7.2 | `.github/renovate.json5` | Enable Renovate-controlled PR automerge only for stable nonmajor dev dependencies and lock maintenance, with 14-day age and explicit exclusions.     | 7.1     | Resolved config plus canary dev patch         |
| 7.3 | `.github/renovate.json5` | Delete rollout-only `automerge:false` fields from the eligible rules once 7.2 is canonical; retain durable manual exclusions.                        | 7.2     | Config search and resolved config             |
| 7.4 | Plan and notes           | Mark every superseded path removed and the new path canonical. Do not close with a migrating item.                                                   | 7.2–7.3 | Final removal matrix and clean tree           |

**Gate:** canary merges only after four checks and its Renovate stability status pass; full validation passes; removal searches are clean; lifecycle table contains only `canonical` or `removed`.

## 5. Validation Strategy

### Testing strategy

| What to test                         | Type                      | Location                                      | Why                                                  |
| ------------------------------------ | ------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| Config schema and deprecations       | Contract                  | Renovate validator workflow                   | Rejects invalid or migrated options.                 |
| Manager coverage and effective rules | Integration               | local Renovate extraction + new validator     | Proves discovery and merged policy, not only syntax. |
| Extraction validator parser          | Unit/self-test            | `validate-renovate-extraction.js --self-test` | Locks parser behavior to the pinned Renovate output. |
| Action pin syntax                    | Static policy + self-test | `validate-github-action-pins.js`              | Rejects mutable executable references.               |
| Required check names                 | Contract                  | existing required-context validator           | Keeps workflow names and SSOT aligned.               |
| Live required checks                 | External integration      | GitHub branch protection + canary PR          | Proves settings, not only files.                     |
| Extension dependency closure         | Contract/integration      | existing extension validator + staged tree    | Proves required/excluded dependencies agree.         |
| Extension reproducibility            | Artifact comparison       | two clean MCPB builds                         | Detects unlocked resolution or staging drift.        |
| Release semantics                    | Hosted integration        | representative Renovate PR + Release Please   | Proves `fix(deps)` reaches release machinery.        |
| Node support                         | Matrix/system             | server 22/24; CLI supported floor             | Proves the documented deliverable boundaries.        |

### Commands

Run from `server/` unless a command explicitly changes directory:

```bash
npm run typecheck
npm run typecheck:tests
npm run lint:ratchet
npm run test:ci
npm run validate:all
npm run validate:arch
npm run pack:mcpb
npm run pack:mcpb:validate
```

Run from repository root:

```bash
npm ci
npm run mcpb:validate
renovate-config-validator --strict .github/renovate.json5
renovate --platform=local --dry-run=extract
node server/scripts/validate-renovate-extraction.js < extraction.jsonl
node server/scripts/validate-github-action-pins.js
```

The full `npm run lint` and `npm run validate:all` status must be reported separately if existing debt causes a failure; targeted gates remain blocking for changed behavior.

## 6. Completion Contract

### Done criteria

| Criterion                | Validation                       | Pass condition                                                   |
| ------------------------ | -------------------------------- | ---------------------------------------------------------------- |
| Release-aware PRs        | Extraction plus hosted PR        | Production = `fix(deps)`; other audited classes = `chore(deps)`. |
| Full extraction          | Extraction validator             | Every expected dependency source found exactly once.             |
| Immutable Actions        | Static validator + GitHub policy | No mutable external ref; workflows pass.                         |
| Protected delivery       | Branch API + canary PR           | Four exact checks required and enforced.                         |
| Deterministic MCPB       | Two clean builds                 | Same locked dependency/file inventory; MCPB validation passes.   |
| Accurate runtime support | Search + matrix                  | No stale server-18 claim; server 22/24 and CLI contract pass.    |
| Safe automation          | Hosted evidence + canary         | Only eligible dev/lock PR auto-merges after four checks.         |
| Migration closed         | Removal matrix                   | No `migrating` artifact or superseded path remains.              |

### Documentation updates

| Document                             | Update                                                |
| ------------------------------------ | ----------------------------------------------------- |
| `CLAUDE.md`                          | Canonical split Node support and validation contract. |
| `CONTRIBUTING.md`                    | Contributor runtime matrix.                           |
| `server/README.md`                   | Server Node floor.                                    |
| `docs/guides/identity-scope.md`      | Deployment prerequisite.                              |
| `docs/portfolio/design-decisions.md` | Runtime claim.                                        |
| `docs/TODO.md`                       | Correct completed CI policy.                          |
| `CHANGELOG.md`                       | Unreleased Changed entry.                             |
| This plan + implementation notes     | Decisions, evidence, deviations, and removal status.  |

### Risks and rollback

| Risk                                    | Impact                         | Mitigation                                              | Rollback                                                                                                   |
| --------------------------------------- | ------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Production rule loses during merge      | Missing release                | Put specific rule after defaults; assert effective type | Disable Renovate PR creation and restore last known config commit.                                         |
| Pin uses incorrect SHA                  | Compromised or failed workflow | Verify upstream tag object and repository origin        | Revert the individual pin to the previously recorded SHA, not a mutable tag.                               |
| Local extraction format changes         | False CI failure               | Pin Renovate and self-test parser                       | Revert Renovate bump; do not bypass the extraction gate.                                                   |
| Locked staging omits runtime dependency | Broken MCPB                    | Required/excluded validator and unpacked smoke          | Revert packaging tier to last known artifact process while keeping MCPB exact; reopen plan before release. |
| Four checks deadlock merge              | Blocked PRs                    | Require only recently reporting stable job names        | Restore captured before-state protection JSON, diagnose, and reapply all four before closeout.             |
| Automerge scope widens                  | Unreviewed change              | Later explicit exclusions and hosted canary             | Set top/rule automerge false immediately; keep observation evidence.                                       |

### Mandatory legacy-removal matrix

| Superseded artifact                          | Delete when                                                                                                         | Proof                                           | Final state |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------- |
| Global `chore(deps)` prefix                  | Semantic extraction assertions pass                                                                                 | Production `fix`, tooling `chore`               | `removed`   |
| Generic security patch/auto-merge rule       | Vulnerability alert policy resolves correctly                                                                       | Immediate manual alert extraction               | `removed`   |
| Nonexistent category labels                  | Minimal-label config validates against live labels                                                                  | Label comparison                                | `removed`   |
| Broad MCPB/global npm regex path             | Root MCPB extraction passes                                                                                         | Exactly one npm extraction                      | `removed`   |
| Unpinned `npx @anthropic-ai/mcpb`            | Root local MCPB validates                                                                                           | Root `npm ci` + MCPB validate                   | `removed`   |
| Staged `npm install`                         | Server-lock staging builds twice                                                                                    | Equivalent inventories                          | `removed`   |
| Mutable external Action tags                 | All pins/workflows pass                                                                                             | Pin validator + CI                              | `removed`   |
| Two-check live protection                    | All four contexts have recent runs                                                                                  | Protection GET + canary                         | `removed`   |
| Collapsed Node 18–24 server claim            | Docs and matrix agree                                                                                               | Stale-claim search                              | `removed`   |
| Rollout-only eligible-rule `automerge:false` | Maintainer accepts accelerated rollout and canary succeeds                                                          | Hosted canary                                   | `removed`   |
| TypeScript 7 `allowedVersions` hold          | ts-jest and typescript-eslint admit 7, and architecture validation cruises a non-zero module graph under 7          | Peer-range evidence plus hosted full CI         | `canonical` |
| CLI TypeScript 6 `allowedVersions` hold      | A dedicated CLI migration passes typecheck, build, integration tests, and the full protected matrix on TypeScript 6 | Hosted PR #192 failure plus future migration CI | `canonical` |

### Release convention

- **Commit:** `fix(deps): align Renovate with release and packaging contracts`
- **Scope:** `deps`
- The plan may use multiple commits by tier; production-affecting dependency semantics and packaging corrections use `fix(deps)`, while policy/docs-only follow-ups use `chore(deps)` or `docs` as appropriate.

### Growth capture

- [x] Capture the pattern “dependency automation is a delivery contract, not a bot config” after implementation evidence confirms it.
- [ ] Record whether pinned local extraction remains stable across the next Renovate upgrade.
- [x] Record the server/CLI Node support distinction in the tracked operator handbook after Phase 4 found the packaged/runtime mismatch.
- [ ] Feed any user correction into the owning workflow skill and observation ledger immediately.

## 7. Execution Notes

- The working tree was dirty from another session when this plan was written. Only this new plan file was added; none of that session's files were changed.
- Keep `plans/renovate-maintenance-remediation-2026-08-01-implementation-notes.md` beside this plan during implementation.
- Record deviations under `## Deviations`, choose the conservative action, and update this plan before retrying a failed approach.
- The plan is incomplete until Phase 7 and the legacy-removal matrix are complete.
