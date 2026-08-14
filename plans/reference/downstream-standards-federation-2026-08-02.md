---
title: "Downstream Standards Federation Implementation Plan"
date: 2026-08-02
status: reference
tags: []
---

# Downstream Standards Federation Implementation Plan

**Status:** RETIRED to reference 2026-08-12 — the contract layer shipped; the open remainder moved
to [`agent-plugins-migration-2026-08-08.md`](../agent-plugins-migration-2026-08-08.md) **Tier 7**.

**Companion:**
[`downstream-standards-federation-2026-08-02-implementation-notes.md`](downstream-standards-federation-2026-08-02-implementation-notes.md)
— the deviation log. Retained as `reference` alongside this file rather than archived: it records
why several hold points were satisfied without anyone noticing, which is the evidence Tier 7
inherited.

**What shipped and still stands** (do not re-derive from this file — it is the record, not the
queue): `minipuft/repository-standards` v1.1.0 at an immutable SHA, a required
`Consumer Contract / Consumer Contract` on gemini-prompts, opencode-prompts and minipuft-plugins,
SHA-pinned Actions across all three, opencode's exact-tarball publication path, auto-merge-only
release synchronization upstream (`validate-release-workflow.js` accepts nothing else), and a
fleet drift auditor that passed authenticated with zero unexplained drift.

**Why it retired unfinished.** The five external hold points below are settings and credentials,
not code, and they did not move for ten days inside a plan whose every other row was code. Three
became downstream of the agent-plugins tiers; a fourth — hold point #4, waiting on
`downstream-sync.yml` producing sync PRs — became **unreachable** when that plan's row 3.2 deleted
the workflow. Tier 7 carries the live remainder and names the four rows that are superseded rather
than pending. The Completion Checklist and hold points below are kept as written, and are now
**historical**: read Tier 7 for current state.
**Date:** 2026-08-02 (America/Denver)
**Risk:** High — cross-repository CI, publishing, protection, credential, and dependency-writer changes
**Lifecycle:** upstream release synchronization = canonical product writer; downstream Dependabot automation = legacy; shared standards = proposed; local downstream adapters = canonical after shadow validation

## Intent

Align the first-party downstream repositories with the release, artifact, dependency, and workflow standards established in `minipuft/claude-prompts-mcp` without copying complete workflows or coupling their source trees.

The target model is:

1. `minipuft/claude-prompts-mcp` owns released `claude-prompts` state and downstream synchronization.
2. A public, versioned `minipuft/repository-standards` repository owns shared consumer contracts, reusable validation, and generic Renovate policy.
3. Each downstream owns a small profile, thin workflow caller, and product-specific tests.
4. Every downstream default branch has a stable required contract check before automatic merging.
5. A read-only fleet audit reports drift; it does not mutate downstream repositories.

## Planning Safety

- This document is planning-only; no downstream repository was modified.
- Do not create a worktree for this planning task.
- Preserve the current shared checkout and its unrelated changes.
- Implement each repository through its own reviewable PR; do not push directly to a default branch.
- Do not add a required context until that exact check name has completed successfully in the target repository.
- Do not delete an updater, publish path, or merge path until its replacement guard passes.

## Compound Diagnosis

**Downstream governance drift + dual-writer dependency automation.**

The repositories share one product lifecycle, but their installed versions, package-manager checks, workflow pinning, publication verification, merge protection, and update ownership have drifted. Copying more workflow YAML would reproduce the same failure mode. The remediation is a versioned contract layer with local adapters and one product-version writer.

## Discovery Evidence

| Repository/surface                | Verified current state                                                                                                      | Consequence                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `claude-prompts` release workflow | `sync-downstream` at `.github/workflows/extension-publish.yml:272`; matrix has marketplace `direct`, Gemini/OpenCode `auto` | Capability routing exists, but marketplace remains an unprotected exception |
| Release validator                 | `MERGE_MODES = auto,direct` at `server/scripts/validate-release-workflow.js:11`                                             | Direct merging is still accepted policy                                     |
| Packed npm verifier               | Budgets and runtime verification in `server/scripts/verify-package-artifact.js`                                             | Reusable evidence pattern exists for OpenCode publishing                    |
| Upstream Renovate                 | Digest pins, 3-day default age, 14-day development soak, lock maintenance, vulnerability policy                             | Generic policy can be extracted; TypeScript/MCP rules must remain local     |
| Marketplace                       | Manifest reports `claude-prompts` 3.1.1/MIT from `dist`; no CI required check                                               | Direct merge is honest but weaker than the target standard                  |
| Gemini                            | Node 24, `npm ci`, required `validate`; range `^3.0.0`, lock resolves 3.0.0                                                 | Local lock is behind npm latest 3.1.1                                       |
| OpenCode                          | Node 24 declared; required `validate` and `validate-plugin`; range `^3.0.0`, lock resolves 3.0.1                            | Local lock is behind; CI/release package managers disagree                  |
| OpenCode CI                       | `bun-version: latest` and `bun install` are authoritative                                                                   | CI does not prove the `npm ci` release path                                 |
| OpenCode publishing               | Two `npm pack --dry-run` calls, then working-directory `npm publish`; token and OIDC are both present                       | Previewed and published artifacts may diverge                               |
| Downstream updates                | Dependabot watches `claude-prompts`; upstream release workflow also writes it                                               | Competing writers produce stale/superseded PRs                              |
| Actions settings                  | Upstream requires SHA pins; downstream repositories do not                                                                  | Shared workflow adoption must include a guarded pin transition              |

## Scope

```yaml
work_type: feature
secondary: refactor
objective: Establish versioned, testable downstream standards with one product writer, repository-specific consumer contracts, protected merge paths, and automated drift reporting.
success_signal: Downstream locks match the intended release; stable required contract checks pass; OpenCode publishes the exact verified tarball; marketplace auto-merges through protection; Renovate owns non-product updates; fleet audit reports zero unexplained drift.
non_goals:
  - Monorepo consolidation
  - Git submodules
  - Copying upstream runtime source into downstream repositories
  - One conditional workflow containing every repository's product logic
  - Automatic mutation by the fleet auditor
constraints:
  - One repository per implementation PR
  - Immutable shared-workflow references
  - Shadow checks before protection
  - No deletion before replacement evidence
  - No direct default-branch pushes
```

## Decisions

| Decision                  | Chosen                                                         | Rejected                         | Reason                                                       |
| ------------------------- | -------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------ |
| Standards owner           | Public `minipuft/repository-standards`                         | Product repo or copied files     | Policy should have an independent version/adoption lifecycle |
| Workflow reference        | Immutable commit SHA with standards-version comment            | `@main` or floating tag          | Prevents an unreviewed fleet-wide behavior change            |
| Shared shape              | Base policy + marketplace/node-consumer/npm-publisher profiles | Universal workflow               | Preserves visible local behavior and limits conditionals     |
| Product dependency writer | Upstream release synchronization                               | Upstream + Dependabot/Renovate   | One writer prevents stale PRs and lock drift                 |
| Other dependency writer   | Shared Renovate preset                                         | Copied Dependabot configurations | Matches upstream stability and action-pin policy             |
| Marketplace merge         | Required contract then auto-merge                              | Permanent direct merge           | Removes the unprotected exception                            |
| OpenCode package manager  | `npm ci` authoritative; pinned Bun compatibility optional      | Bun `latest` authoritative       | CI and publication must prove the same lock semantics        |
| Audit behavior            | Read-only scheduled report                                     | Cross-repository auto-fix        | Keeps drift observable without mutation risk                 |

## Unknowns and Guarded Defaults

| Unknown                              | Default                                                          | Promotion guard                                                                  |
| ------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Renovate App authorization           | Treat as absent until verified in Gemini/OpenCode                | Dashboard and one representative non-product PR per repo                         |
| OpenCode npm trusted publisher       | Retain token fallback until configured                           | A new-version publication carries provenance from the expected workflow          |
| Cross-repository workflow permission | Use a public standards repo and read-only caller                 | Real shadow invocation succeeds from each downstream                             |
| Required check name                  | `Consumer Contract`                                              | Observe exact name in a real run before protection change                        |
| Fleet-audit credential               | Start with public/read-only API access                           | Add a fine-grained credential only if protection metadata is inaccessible        |
| Immutable v3.1.1 CLI mismatch        | Downstream consumer profiles validate server/hooks surfaces only | Upstream exact-package verifier proves corrected CLI version on the next release |

## Contract-First Interfaces

### Downstream contract v1

```ts
type DownstreamProfile = "marketplace" | "node-consumer" | "npm-publisher";

interface DownstreamContractV1 {
  schemaVersion: 1;
  profile: DownstreamProfile;
  nodeVersionFile?: ".node-version";
  packageManager?: "npm";
  upstreamPackage: "claude-prompts";
  upstreamWriter: "claude-prompts-release-sync";
  requiredPaths: string[];
  requiredChecks: string[];
  localValidationWorkflow: string;
  publish?: {
    packageName: string;
    requiresTrustedPublisher: true;
    packedSizeBudgetBytes: number;
    unpackedSizeBudgetBytes: number;
  };
}
```

### Reusable workflow

```yaml
on:
  workflow_call:
    inputs:
      profile:
        type: string
        required: true
      contract-path:
        type: string
        default: downstream-contract.json
permissions:
  contents: read
```

The shared workflow owns frozen installation, schema validation, installed version/path inventory, and safe profile smoke tests. Local build, type, test, symlink, and plugin behavior remain in the downstream repository.

### Renovate presets

- `renovate/default.json`: generic schedule, release-age gates, Action digest pinning, grouped updates, lock maintenance, manual majors, and vulnerability processing.
- `renovate/downstream.json`: extends the base; ignores `claude-prompts`; holds publishing/build tools for manual review.
- Consumers reference a reviewed tagged preset such as `github>minipuft/repository-standards:downstream#1.0.0`.

### Fleet inventory

```ts
interface FleetRepositoryV1 {
  repository: string;
  profile: DownstreamProfile;
  standardsVersion: string;
  requiredChecks: string[];
  expectedNode: "24";
  claudePromptsWriter: "claude-prompts-release-sync";
  mergeMode: "auto";
}
```

## Consumer Consequence Map

| Consumer                  | Reads                                            | Writes                                 | Decides                        | View/evidence                      |
| ------------------------- | ------------------------------------------------ | -------------------------------------- | ------------------------------ | ---------------------------------- |
| Upstream release workflow | released version, fleet registry                 | downstream PRs/locks/manifest versions | product version to synchronize | release run + sync PRs             |
| Shared consumer workflow  | local contract, package/lock, installed artifact | check result only                      | contract pass/fail             | stable `Consumer Contract` context |
| Gemini local CI           | Gemini extension and symlink                     | check result                           | Gemini-specific compatibility  | `validate` context                 |
| OpenCode local CI         | source, npm lock, optional Bun pin               | build/test results                     | OpenCode compatibility         | `validate`, `validate-plugin`      |
| OpenCode publisher        | release tag, exact verified tgz                  | npm release                            | publish eligibility            | provenance + package inventory     |
| Marketplace contract      | marketplace JSON and upstream `dist` metadata    | check result                           | sync PR eligibility            | required contract context          |
| Renovate                  | shared preset + local overrides                  | non-product dependency PRs             | age/group/manual policy        | dependency dashboard               |
| Fleet auditor             | fleet inventory, public files/settings           | dashboard issue                        | drift classification           | scheduled report                   |

## Lifecycle and Guarded Removal

| Migrating artifact                               | Delete once                                                              | Validation proving guard                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Downstream `claude-prompts` Dependabot ownership | Upstream sync PRs pass shared contracts and Renovate ignores the package | No updater PR source except upstream; audit reports one writer |
| Gemini/OpenCode `.github/dependabot.yml`         | Renovate dashboard and representative PR succeed                         | Strict config validation + merged Renovate PR                  |
| Gemini/OpenCode `dependabot-auto-merge.yml`      | Renovate merge policy succeeds                                           | PR history records expected soak/check behavior                |
| Duplicated common inline CI checks               | Shared contract is required and local tests still pass                   | Shadow package-sync and ordinary PR runs                       |
| Marketplace `direct` merge mode                  | Required contract is active and a sync PR auto-merges                    | Protection API + PR check/merge timestamps                     |
| OpenCode Bun-latest primary path                 | npm-authoritative CI and optional pinned Bun smoke pass                  | Searches find no `bun-version: latest`                         |
| OpenCode token/working-directory publish         | Trusted exact-tarball publication succeeds                               | npm provenance and tarball identity evidence                   |

## Seven-Step Implementation

### Step 1 — Reconcile Gemini and OpenCode to `claude-prompts` 3.1.1

| #   | Repository/file                      | Change                                                                                          | Depends | Verify                                                                                           |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| 1.1 | `gemini-prompts/package-lock.json`   | Refresh only the `claude-prompts` subtree so `^3.0.0` resolves 3.1.1                            | none    | `npm ci`; installed version 3.1.1; server/resources/hooks exist; startup and symlink checks pass |
| 1.2 | `opencode-prompts/package-lock.json` | Refresh only the same subtree to 3.1.1                                                          | none    | `npm ci`; installed version 3.1.1; typecheck/build/test/plugin checks pass                       |
| 1.3 | Both PR descriptions                 | State that v3.1.1 downstream profiles consume server/hooks; CLI equality remains upstream-owned | 1.1/1.2 | Lock diffs contain only attributable dependency changes                                          |

**Parallelism:** Gemini and OpenCode PRs may proceed independently.
**Exit gate:** Both default branches resolve 3.1.1 through `npm ci`.

### Step 2 — Close superseded downstream dependency PRs

| #   | Repository/state             | Change                                                                   | Depends          | Verify                                                               |
| --- | ---------------------------- | ------------------------------------------------------------------------ | ---------------- | -------------------------------------------------------------------- |
| 2.1 | OpenCode PR #26              | Close with links to merged v3 migration and Step 1 PR                    | Step 1           | PR closed with audit comment; current main remains v3                |
| 2.2 | Open downstream PR inventory | Classify active, superseded-by-standards, or blocked                     | Step 1           | Every PR has a disposition; no independent security fix is discarded |
| 2.3 | Old Action/updater PRs       | Comment now; close only after replacement SHA-pinning/Renovate PR merges | 2.2, Steps 4/5/7 | Each closure links replacement evidence                              |

**Exit gate:** Obsolete product-version PRs are closed; still-valid updates remain until their replacement lands.

### Step 3 — Create and release `repository-standards` v1

| #   | New file/surface                              | Change                                                                 | Verify                                                                |
| --- | --------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 3.1 | `contracts/downstream-contract.schema.json`   | Define schemaVersion 1 and three profiles                              | Valid/invalid fixtures prove each rule fails                          |
| 3.2 | `profiles.json`                               | Register paths, checks, Node/package-manager policy, and writer        | Registry self-test                                                    |
| 3.3 | `actions/verify-consumer/action.yml`          | Composite action entrypoint                                            | actionlint, YAML parse, profile fixture calls                         |
| 3.4 | `actions/verify-consumer/verify-consumer.mjs` | Validate contract, frozen install, installed inventory, and safe smoke | Self-tests reject stale version/path/writer/marketplace/startup cases |
| 3.5 | `.github/workflows/consumer-contract.yml`     | Read-only reusable workflow with stable check                          | Cross-repository fixture succeeds without write secrets               |
| 3.6 | `renovate/default.json`                       | Generic upstream policy extraction                                     | Strict Renovate validation                                            |
| 3.7 | `renovate/downstream.json`                    | Ignore `claude-prompts`; hold publisher/build tools                    | Resolved preset inspection                                            |
| 3.8 | `package.json` + fixtures                     | Private validation command registry                                    | Clean install, format/schema/self-tests/action pins                   |
| 3.9 | Release/tag `v1.0.0`                          | Publish reviewed contract and record immutable SHA                     | Tag and SHA resolve to the same commit                                |

**New-file justification:** This is a new cross-repository API with no existing owner. Schema, registry, executable verifier, reusable workflow, and presets have different consumers and validation lifecycles; combining them would obscure contracts.
**Exit gate:** Standards v1.0.0 passes its fixtures and exposes a reviewed immutable SHA.

### Step 4 — Adopt standards in Gemini, shadow first

| #   | Repository/file/setting                   | Change                                                                                         | Depends | Verify                                                    |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------- |
| 4.1 | `downstream-contract.json`                | Add node-consumer profile, Node 24, server/hooks paths, checks, sole writer                    | Step 3  | Standards schema passes                                   |
| 4.2 | `.github/workflows/consumer-contract.yml` | Thin caller pinned to standards SHA; read-only                                                 | 4.1     | Shadow `Consumer Contract` check passes                   |
| 4.3 | `.github/workflows/ci.yml`                | Retain Gemini-specific symlink/extension tests; remove only common duplication after promotion | 4.2     | Package-sync and ordinary dependency PRs pass both checks |
| 4.4 | Branch protection                         | Require `Consumer Contract` after observed shadow success                                      | 4.2/4.3 | API reports strict required contexts                      |
| 4.5 | Workflow Action refs/settings             | Pin reviewed SHAs, then require SHA pinning                                                    | 4.3     | Action-pin check and repository setting pass              |

**Exit gate:** Two representative PR classes pass existing and shared contexts; common duplicated checks are removed in a follow-up PR.

### Step 5 — Adopt standards in OpenCode and align publishing

| #   | Repository/file/setting                   | Change                                                                                                     | Depends | Verify                                                                |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------- |
| 5.1 | `downstream-contract.json`                | Add npm-publisher profile, Node 24, paths/checks, measured budgets, sole writer                            | Step 3  | Schema passes                                                         |
| 5.2 | `.github/workflows/consumer-contract.yml` | Add SHA-pinned read-only caller                                                                            | 5.1     | Shadow check passes                                                   |
| 5.3 | `.github/workflows/ci.yml`                | Make `npm ci` authoritative; run type/build/Jest under Node 24; optionally retain pinned Bun compatibility | Step 1  | Lock mismatch fails; existing suite and optional Bun smoke pass       |
| 5.4 | `scripts/verify-package-artifact.mjs`     | Pack, inspect, temp-install, resolve bin/export, safe-smoke, size-ratchet                                  | 5.3     | Negative self-tests + real tarball pass                               |
| 5.5 | `package.json`                            | Register verifier commands                                                                                 | 5.4     | Commands run from clean install                                       |
| 5.6 | `.github/workflows/npm-publish.yml`       | Build once, verify one tgz, publish that exact path with provenance                                        | 5.4/5.5 | Manual artifact run retains exact tgz; tag/version/main checks pass   |
| 5.7 | npm trusted-publisher settings            | Configure expected workflow/environment                                                                    | 5.6     | New release provenance names expected workflow/ref                    |
| 5.8 | Protection and Action pins                | Require contract; pin Actions; enable SHA requirement                                                      | 5.2-5.6 | API and Action-pin validation pass                                    |
| 5.9 | Legacy removal                            | Delete Bun-latest primary and token/working-directory publication                                          | 5.7/5.8 | No floating Bun, token env, or bare working-directory publish remains |

**Exit gate:** CI, exact package consumer verification, and one real trusted publication pass before old paths are deleted.

### Step 6 — Protect marketplace synchronization and remove direct merge

| #   | Repository/file/setting                               | Change                                                                      | Depends   | Verify                                                  |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------- | --------- | ------------------------------------------------------- |
| 6.1 | Marketplace `downstream-contract.json`                | Add marketplace profile and required JSON/source/version/license fields     | Step 3    | Schema passes                                           |
| 6.2 | Marketplace `.github/workflows/consumer-contract.yml` | Call marketplace verifier through pinned standards SHA                      | 6.1       | JSON and upstream `dist` metadata match                 |
| 6.3 | Marketplace protection                                | Require strict `Consumer Contract`; retain auto-merge                       | 6.2       | A failing/pending test PR cannot merge                  |
| 6.4 | Upstream `extension-publish.yml`                      | Change marketplace `merge_mode` from direct to auto                         | 6.3       | Release validator selects auto                          |
| 6.5 | Upstream `validate-release-workflow.js`               | Require auto for all registered downstreams; reject direct in self-test     | 6.4       | Negative fixtures pass                                  |
| 6.6 | Upstream direct branch                                | Delete after one marketplace sync PR auto-merges through the required check | Next sync | Search finds no direct path; PR timestamps prove gating |

**Exit gate:** Real marketplace synchronization passes the required contract and auto-merges; direct mode is removed.

### Step 7 — Establish sole writer, shared Renovate, and drift audit

| #    | Repository/file/setting                             | Change                                                                                      | Depends   | Verify                                                               |
| ---- | --------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------- |
| 7.1  | Gemini `renovate.json`                              | Extend tagged downstream preset; local Gemini overrides only                                | Steps 3/4 | Strict validation; dashboard; `claude-prompts` ignored               |
| 7.2  | OpenCode `renovate.json`                            | Extend preset; cover root + `.opencode`; local test-tool rules                              | Steps 3/5 | Both manifests extracted; product package ignored                    |
| 7.3  | Renovate App/settings                               | Authorize and enable dashboard/vulnerability processing                                     | 7.1/7.2   | One representative non-product PR per repo                           |
| 7.4  | Dependabot files                                    | Delete both repositories' config and auto-merge workflow                                    | 7.3       | No Dependabot version writer remains; security alerts stay enabled   |
| 7.5  | Remaining stale PRs                                 | Close with links to standards/Renovate replacements                                         | 7.4       | No superseded writer PR remains open                                 |
| 7.6  | Upstream release sync                               | Bounded retry for npm propagation; fail rather than accept a lock resolving another version | Steps 4/5 | Fixture rejects old resolved version; real sync lock matches release |
| 7.7  | Standards `fleet.json`                              | Register repos, profiles, SHA/version, checks, Node, writer, auto mode                      | Steps 4-6 | Fleet schema passes                                                  |
| 7.8  | Standards `scripts/audit-fleet.mjs` + tests         | Read and compare files/settings; emit deterministic non-mutating report                     | 7.7       | Fixtures reject stale SHA/Node/check/lock/writer/merge mode          |
| 7.9  | Standards `.github/workflows/fleet-drift-audit.yml` | Weekly/manual read-only audit and one dashboard issue                                       | 7.8       | Manual run reports zero drift after rollout                          |
| 7.10 | Upstream validator/docs/changelog                   | Assert sole writer and document recovery/adoption                                           | 7.1-7.9   | Scoped upstream validation and next release sync pass                |

**Exit gate:** Renovate replacement evidence passes, duplicate automation is deleted, upstream synchronization is exact, and fleet audit reports zero unexplained drift.

## PR and Settings Order

1. Gemini and OpenCode lock PRs in parallel.
2. Close OpenCode #26 after its reconciliation merges.
3. Bootstrap and tag standards v1.0.0.
4. Gemini and OpenCode shadow adoption in parallel.
5. OpenCode publication migration after trusted-publisher configuration.
6. Marketplace contract PR → required-check setting → upstream auto-mode PR → real sync → direct-mode deletion.
7. Renovate adoption → representative PR evidence → Dependabot deletion → stale PR cleanup.
8. Fleet audit becomes authoritative after all profiles are enforced.
9. Validate the integrated system on the next `claude-prompts` release before closing the plan.

## Testing Strategy

| What to test                           | Type                         | Location                | Reason                                                      |
| -------------------------------------- | ---------------------------- | ----------------------- | ----------------------------------------------------------- |
| Contract schema rules                  | Unit/negative fixtures       | standards repo          | Every rule must be falsifiable                              |
| Profile registry                       | Unit                         | standards repo          | Prevent conditional/profile drift                           |
| Consumer installation and inventory    | Artifact integration         | Gemini/OpenCode callers | Tests what consumers install, not source declarations       |
| Marketplace JSON and upstream metadata | Contract integration         | marketplace caller      | Gates version/license/source synchronization                |
| OpenCode tgz                           | Package consumer integration | OpenCode verifier       | Proves exact published artifact, bins, exports, and budgets |
| Reusable workflow permissions          | Workflow fixture             | standards repo          | Prevents hidden write-token requirements                    |
| Action SHA policy                      | Static validation            | every repo              | Aligns execution supply-chain policy                        |
| Required context transition            | GitHub settings/API          | each downstream         | Prevents protection from naming a nonexistent check         |
| Renovate preset resolution             | Strict config validation     | standards + downstream  | Proves inheritance and sole-writer ignore rule              |
| Release synchronization exactness      | Negative fixture + real PR   | upstream                | Prevents registry-lag locks from merging                    |
| Fleet drift detection                  | Unit fixtures + manual run   | standards repo          | Proves detection without mutation                           |
| End-to-end release                     | Release evidence             | all repositories        | Confirms artifact → sync PR → checks → auto-merge flow      |

## Done Criteria

| Criterion                 | Validation                               | Pass condition                                                 |
| ------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| Locks aligned             | Read default-branch locks after `npm ci` | Gemini/OpenCode resolve intended release                       |
| Shared standards released | Resolve tag and SHA                      | v1.0.0 tag equals reviewed immutable commit                    |
| Gemini protected          | API + representative PRs                 | Local and contract contexts required and green                 |
| OpenCode CI aligned       | PR checks                                | npm is authoritative; optional Bun is pinned/advisory          |
| OpenCode publish aligned  | npm provenance + tgz inventory           | Exact verified tgz is published through trusted workflow       |
| Marketplace protected     | API + sync PR                            | Contract required and auto-merge succeeds                      |
| Direct mode removed       | Upstream search/self-test                | No direct case or accepted direct mode remains                 |
| One product writer        | Config/PR-source audit                   | Only upstream release synchronization changes `claude-prompts` |
| Renovate canonical        | Dashboards + representative PRs          | Shared preset resolves and operates in both repos              |
| Dependabot paths removed  | File/PR audit                            | Duplicate configs/workflows and superseded PRs are gone        |
| Drift audit clean         | Manual/scheduled run                     | Zero unexplained fleet differences                             |
| Migration closed          | Lifecycle checklist                      | Every migrating artifact is canonical or removed               |

## Documentation

| Document                        | Update                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| Standards README                | Profiles, immutable adoption, permissions, local override rules, versioning, rollback |
| Standards release notes         | Contract/preset changes and consumer migration notes                                  |
| Gemini README/contributing docs | Shared contract, local checks, dependency ownership                                   |
| OpenCode release docs           | npm-authoritative CI, exact tgz, trusted publishing recovery                          |
| Marketplace README              | Required contract and source/ref validation                                           |
| Upstream release-process guide  | Sole writer, exact lock synchronization, marketplace protection, audit recovery       |
| Upstream changelog              | Changed entry for downstream standards federation                                     |
| This plan                       | Mark each guard, removal, external setting, and release result                        |

## Risks, Mitigation, and Rollback

| Risk                                      | Impact                       | Mitigation                                                                    | Rollback                                                               |
| ----------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Shared workflow breaks several repos      | Fleet CI blocked             | Immutable SHA; shadow adoption; profile fixtures                              | Revert one caller or update to a new standards patch SHA               |
| Required check configured too early       | PRs cannot merge             | Observe exact check first                                                     | Remove context before reverting workflow                               |
| Renovate unavailable                      | Dependency updates stall     | Keep Dependabot until dashboard + PR evidence                                 | Revert Renovate adoption; retain old files                             |
| Two product writers remain                | Conflicting/stale PRs        | Shared preset ignores package; audit writer source                            | Disable non-upstream writer and close its PR                           |
| Registry propagation resolves old version | Incorrect lock merges        | Bounded retry then fail                                                       | Leave sync PR open and rerun after propagation                         |
| Trusted publisher misconfigured           | OpenCode release fails       | Test manual artifact; retain token path until real proof                      | Revert publication workflow before removing publisher setting          |
| Bun-only behavior regresses               | OpenCode compatibility issue | Keep pinned advisory Bun smoke where useful                                   | Restore pinned Bun job without making it lock authority                |
| Marketplace protection blocks sync        | Release propagation stalls   | Validate fixture PR before mode switch                                        | Remove new required context or revert auto-mode PR; do not direct-push |
| Audit token is over-privileged            | Security exposure            | Read public data first; least-privilege fine-grained token if required        | Revoke token; audit remains non-mutating                               |
| v3.1.1 CLI mismatch confuses contract     | False downstream failure     | Consumer profiles test used server/hooks surfaces; upstream owns CLI equality | No downstream waiver code; verify corrected next release upstream      |

## Rollback Principles

- Revert one repository at a time; standards tags remain immutable.
- Remove a newly required context before removing the workflow that emits it.
- If standards v1 is defective, release v1.0.1 and adopt it by PR rather than moving v1.0.0.
- Do not reintroduce dual product writers as a rollback. Restore the previous sole functioning writer temporarily.
- Leave failed synchronization PRs open for diagnosis; do not push directly to downstream default branches.
- Do not remove npm token fallback until trusted publication evidence exists.

## Release and Commit Convention

```yaml
commit_convention: "type(scope): description"
scopes:
  standards: shared contract/preset/audit repository
  deps: lock reconciliation and updater ownership
  ci: consumer checks, action pins, package-manager parity
  release: exact publication and downstream synchronization
  marketplace: marketplace validation/protection
changelog:
  section: Changed
  entry: Federate downstream consumer, publication, dependency-update, and merge-protection standards through versioned contracts and a sole upstream release writer.
```

## Completion Checklist

- [x] Gemini lock resolves the intended release.
- [x] OpenCode lock resolves the intended release.
- [x] Superseded product-version PRs are closed with evidence.
- [x] Standards v1.0.0 is released at an immutable SHA.
- [ ] Gemini contract is required and common duplication removed.
- [ ] OpenCode uses npm-authoritative CI and exact verified publication.
- [ ] Marketplace has a required contract and protected auto-merge.
- [ ] Upstream direct mode is removed.
- [ ] Renovate is canonical for non-product dependencies.
- [ ] Downstream Dependabot version workflows/configs are removed.
- [ ] Upstream release synchronization rejects wrong resolved versions.
- [x] Fleet audit reports zero unexplained drift.
- [ ] Next release completes artifact, sync, check, and merge flow.
- [ ] Every migrating lifecycle entry is marked canonical or removed.

## Growth Capture

- [ ] Capture the pattern: **entangle contracts, not source trees**.
- [ ] Capture the guarded required-context migration order: shadow check → observed name → protection → duplicate removal.
- [ ] Capture sole-writer dependency automation as a release-management rule.
- [ ] Evaluate whether the shared contract/profile pattern belongs in the implementation-plan or GitHub repository setup skill after two successful downstream adoptions.

## Path Verification Appendix

| Existing file                                 |   Lines | Verified symbol/field                               |
| --------------------------------------------- | ------: | --------------------------------------------------- |
| `.github/workflows/extension-publish.yml`     |     574 | `sync-downstream:272`, merge registry `289-295`     |
| `server/scripts/validate-release-workflow.js` |     118 | `MERGE_MODES:11`                                    |
| `server/scripts/verify-package-artifact.js`   |     202 | budgets `15-16`, runtime verifier `64`              |
| `.github/renovate.json5`                      |     303 | digest pin `10`, release ages `90/209/220`          |
| `scripts/classify-validation-scope.js`        |     169 | classifier `33`                                     |
| Gemini `.github/workflows/ci.yml`             |      43 | `npm ci:24`, structure `26`, symlink `37`           |
| Gemini `package.json`                         |      19 | `claude-prompts ^3.0.0:9`                           |
| Gemini `package-lock.json`                    |    2951 | installed 3.0.0 at `1225-1227`                      |
| Gemini `.github/dependabot.yml`               |      24 | product group `10-12`                               |
| Gemini Dependabot auto-merge                  |      27 | merge command `24`                                  |
| Gemini `hooks/lib`                            | symlink | target `../node_modules/claude-prompts/hooks/lib`   |
| OpenCode `.github/workflows/ci.yml`           |      56 | Bun latest/install `17/20/38/41/46`                 |
| OpenCode npm publish workflow                 |      87 | `npm ci:63`, dry-run `77/81`, token/publish `86-87` |
| OpenCode `package.json`                       |      63 | scripts `21-23`, product range `50`                 |
| OpenCode `package-lock.json`                  |    8234 | installed 3.0.1 at `4407-4409`                      |
| OpenCode `.opencode/package.json`             |       8 | nested plugin dependency `5-6`                      |
| OpenCode `.github/dependabot.yml`             |      24 | product group `10-12`                               |
| OpenCode Dependabot auto-merge                |      27 | merge command `24`                                  |
| Marketplace manifest                          |      38 | product `13`, version `15`, source/ref `21-22`      |

All future standards, profile, verifier, caller, and audit paths are explicit new-file creation targets.
