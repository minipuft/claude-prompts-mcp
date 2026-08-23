---
title: Global GitHub-Native Planning and Task Management
date: 2026-08-12
status: active
tracking: https://github.com/minipuft/claude-prompts-mcp/issues/224
tags:
  - planning
  - github
  - automation
  - global-config
---

# Global GitHub-Native Planning and Task Management

## Plan State

- **Lifecycle**: `active`; implementation began 2026-08-13 after the open questions were ruled.
- **Governing repository**: `minipuft/claude-code-config` for global configuration; `minipuft/claude-prompts-mcp` is the first pilot.
- **Implementation constraint**: local global-configuration and pilot edits are authorized. GitHub Project mutation requires a reviewed dry run and an explicit `--apply`; the pilot apply completed on 2026-08-14.
- **Tracking**: added at the publish boundary after the pilot Issue exists. Plan lifecycle remains separate from Project Status.

## Step 1 — Intent and Discovery

### Intent Declaration

| Field                 | Declaration                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Work type             | `feature`                                                                                                  |
| Secondary type        | `refactor`                                                                                                 |
| Confidence            | High                                                                                                       |
| Risk                  | High: global guidance affects every repository; remote setup creates durable GitHub state.                 |
| External dependencies | None. Use the installed `gh` CLI and GitHub APIs after implementation-time official-document verification. |
| Source spec           | `chain-implementation_plan#1` and the 2026-08-12 user request.                                             |
| Next phase            | `/refactoring` before source edits.                                                                        |

### Problem Statement

Plans are locally durable and greppable, but folders alone do not provide a useful cross-task board, scheduling view, discovery intake, or delivery linkage. The desired state is one lifecycle that uses:

- **Discussion** for unresolved discovery, RFCs, and questions.
- **Issue/sub-issue** for accepted work and hierarchy.
- **GitHub Project** for a repository-specific portfolio projection: workflow status, priority, ownership context, release grouping, and focused views.
- **`plans/*.md`** for detailed execution decisions and cross-session state.
- **PR** for delivery evidence and accepted-work closure.

This must extend existing plan hygiene rather than create a second status system, work offline, avoid startup network calls, and remain token-efficient through a small global trigger plus on-demand detail.

### Scope

- `~/.claude/CLAUDE.md`
- `~/.claude/rules/{dev-workflow.md,project-contract.md,ci-release.md,_index.md}`
- `~/.claude/skills/{_index.md,plan,git,dev-workflow,release-engineering,knowledge-capture}`
- New on-demand `~/.claude/skills/github-planning/` capability
- `~/.claude/hooks/lib/{plan_hygiene.py,plan_lint.py}` and focused tests/wrappers/docs
- `~/.claude/settings.json` as an explicit no-startup-network boundary
- `~/.codex/sync-codex-skills.sh` as the existing copied-skill synchronization path
- GitHub capability detection, Project setup, issue/discussion templates, and plan tracking metadata
- `minipuft/claude-prompts-mcp` as the first live pilot

### Non-Goals

- Replacing `plans/*.md` with GitHub Issues or Projects.
- Mirroring GitHub Project Status into plan `status`.
- Mandatory GitHub use for local, offline, non-GitHub, or feature-disabled repositories.
- Network calls at every session start.
- Editing copied Codex skills directly or replacing the existing sync mechanism.
- Hardcoding GitHub Project, field, category, or node identifiers.
- Blocking global enforcement during the first pilot.

### Acceptance Criteria

1. Always-loaded guidance grows by no more than twelve non-index lines and points to one on-demand skill.
2. GitHub planning activates from a verified GitHub remote and repository capabilities, not from git presence alone.
3. No `SessionStart` hook performs GitHub detection.
4. Plan status remains exactly `active`, `backlog`, `done`, or `reference`.
5. Published decision-bearing plans link to one accepted-work Issue or carry an enumerated exception when policy requires it.
6. Local structural validation remains deterministic and network-free.
7. Remote setup is dry-run first, discovers opaque identifiers, requires explicit apply, and is repeatable.
8. The pilot provides six focused board/table views and only the custom fields justified by this repository; release grouping uses the built-in Milestone field.
9. Current issue-form links and required labels validate against `claude-prompts-mcp`.
10. Codex receives the new skill only through the existing sync script.
11. Final acceptance includes global tests, the current repository build, and one useful live lifecycle drive.

## Step 2 — Design

### Compound Diagnosis

**Strong document hygiene without a provider-aware portfolio projection.** The current global system owns plan authoring, plan lifecycle, binding, deviation logs, and structural linting. It lacks a durable discovery-to-delivery projection that can expose repository-specific queues and workflow views. Adding another plan status, tracker file, or startup hook would duplicate ownership and increase token/network cost.

### Semantic Ownership

| Object               | Owns                                                                                                     | Does not own                       |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| GitHub Discussion    | Unresolved ideas, RFC conversation, questions, evidence gathering                                        | Accepted implementation commitment |
| GitHub Issue         | Accepted work, canonical tracking URL, assignee, hierarchy through sub-issues                            | Detailed execution design          |
| GitHub Project       | Portfolio projection: work status, priority, repository-specific classification, release grouping, views | Plan document lifecycle            |
| `plans/*.md`         | Decisions, tier ordering, verified paths, open questions, execution contract                             | Portfolio scheduling status        |
| Implementation notes | Deviations, rulings, validation ledger                                                                   | Plan contract                      |
| Pull request         | Delivery evidence, review, Issue closure                                                                 | Discovery backlog                  |

### Lifecycle

```text
unresolved idea/RFC
  -> Discussion
  -> accepted decision
  -> Issue (sub-issues when hierarchical)
  -> Project projection
  -> decision-bearing plan linked by Issue URL
  -> implementation branch and PR
  -> PR closes Issue
  -> plan becomes done or reference after knowledge capture
```

### Plan Metadata Contract

Existing required frontmatter stays unchanged:

```yaml
title: Example
date: 2026-08-12
status: active
tags: [planning]
```

Provider metadata is additive at the publish boundary:

```yaml
tracking: https://github.com/OWNER/REPOSITORY/issues/123
```

or, when the policy applies but GitHub tracking cannot or should not be used:

```yaml
tracking: none
tracking_reason: local-only
```

Initial exception vocabulary:

- `local-only`
- `offline`
- `provider-unsupported`
- `issues-disabled`
- `operator-opt-out`

Implementation notes inherit their plan's tracking relationship and do not repeat it. Project IDs and field IDs are runtime-discovered state and are not stored in every plan.

### Capability Detection Contract

Detection runs only when `/github-planning` is invoked or at an explicit publish, retire, setup, or validation boundary.

1. Confirm a git worktree.
2. Resolve the canonical remote.
3. Confirm the provider is GitHub.
4. Query repository features and authentication through `gh`.
5. Record a short-lived read-only result under the XDG cache directory.
6. Respect a project override of `auto`, `off`, or `local`.
7. Degrade to local planning when offline, unauthorized, unsupported, or disabled.

The cache is an optimization, not a source of truth. No detection command is registered under `SessionStart`.

### Safe Setup Interface

One Python command surface owns remote planning automation:

```text
github_planning.py detect
github_planning.py plan-setup
github_planning.py apply-setup --apply
github_planning.py validate
```

Safety properties:

- dry-run is the default;
- mutations require an explicit apply flag;
- owner, repository, Project, field, label, and category identifiers are discovered;
- the command reuses matching state rather than creating duplicates;
- partial setup can resume;
- unsupported view mutations produce a precise guided checklist;
- no secrets or auth tokens are written to plan files or cache records.

### Project Profile Contract

There is no universal field template. The automation owns a small base profile and permits explicit
repository-specific additions; unsupported assumptions are omitted until observed work requires them.

- **Name**: `<repository> Roadmap` (private during the pilot)
- **Built-in fields used**: Status, Milestone, Labels, Assignees, Repository
- **Base custom field**: Priority (`Urgent`, `High`, `Normal`, `Low`); unset means not yet prioritized and avoids collision with initiative phase identifiers such as `P7-F8`.
- **`claude-prompts-mcp` custom field**: Area (`Prompt Engine`, `Resource Manager`, `System Control`, `Chains`, `Gates`, `Frameworks`, `CLI / Installation`, `Documentation`, `Repository Automation`, `Other`)
- **Intentionally omitted**: Effort, Target release, Start date, Target date; Milestone owns release grouping, and date/effort fields require demonstrated scheduling demand.
- **Views**:
  - Inbox — table filtered by `label:triage`
  - Now — board filtered by `status:"In Progress"`
  - Backlog — table filtered by `status:Todo -label:triage`
  - Blocked — table filtered by `label:blocked`
  - Releases — table filtered by `-no:milestone`
  - Recently completed — table filtered by `status:Done updated:>@today-30d`

### Rollout Policy

1. Advisory pilot in `claude-prompts-mcp`.
2. Record false positives, auth/API limitations, and manual steps.
3. Repeat in two additional repositories.
4. Consider blocking only after three independent successful pilots.

### Pre-Flight

| Check             | Result                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Domain ownership  | Pass: existing modules retain their current responsibilities; the new skill owns GitHub planning detail.                 |
| Duplication       | Pass: one plan lifecycle, one linter core, one setup command surface, one accepted-work Issue.                           |
| Layer placement   | Pass: minimal rule trigger, detailed skill/reference material, deterministic script automation.                          |
| Naming            | Pass: `github-planning` and `github_planning.py` describe behavior directly.                                             |
| Complexity        | Pass with guard: split lifecycle and setup references; keep script subcommands cohesive.                                 |
| Error handling    | Pass by design: auth, offline, disabled features, partial setup, stale cache, and unsupported APIs are explicit results. |
| Migration cleanup | Pass: no legacy path is replaced; copied Codex skills remain generated from the canonical source.                        |

### Read Before Implementing

- `~/.claude/CLAUDE.md`
- `~/.claude/rules/{dev-workflow.md,project-contract.md,ci-release.md,_index.md}`
- `~/.claude/skills/{_index.md,plan/SKILL.md,git/SKILL.md,dev-workflow/SKILL.md,release-engineering/SKILL.md,knowledge-capture/SKILL.md}`
- `~/.claude/hooks/lib/{plan_hygiene.py,plan_lint.py}`
- `~/.claude/hooks/tests/test_plan_hygiene.py`
- `~/.claude/hooks/planning/{stamp-plan-frontmatter.py,lint-plans.py,plan-review.py}`
- `~/.claude/hooks/README.md`
- `~/.claude/settings.json`
- `~/.codex/sync-codex-skills.sh`
- `.github/ISSUE_TEMPLATE/{config.yml,bug_report.yml,feature_request.yml}`

## Step 3 — Verified Paths

All planned existing paths were verified before this table was finalized. New files are identified separately.

| Existing path                                        | Lines | Verified anchors                                            |
| ---------------------------------------------------- | ----: | ----------------------------------------------------------- |
| `~/.claude/CLAUDE.md`                                |   206 | Planning Default; Plan medium; Subagents & Durable State    |
| `~/.claude/rules/dev-workflow.md`                    |    68 | Pre-Action Skill Gates; plan review boundary                |
| `~/.claude/rules/project-contract.md`                |    28 | Required and Optional Declarations                          |
| `~/.claude/rules/ci-release.md`                      |    87 | GitHub Templates                                            |
| `~/.claude/rules/_index.md`                          |    37 | workflow, CI/release, and project-contract entries          |
| `~/.claude/skills/_index.md`                         |   163 | plan, git, release-engineering, knowledge-capture entries   |
| `~/.claude/skills/plan/SKILL.md`                     |   362 | Plan Medium and artifact guidance                           |
| `~/.claude/skills/git/SKILL.md`                      |   404 | PR creation and GitHub workflow                             |
| `~/.claude/skills/dev-workflow/SKILL.md`             |   320 | durable plans and review routing                            |
| `~/.claude/skills/release-engineering/SKILL.md`      |   149 | GitHub and repository bootstrap                             |
| `~/.claude/skills/knowledge-capture/SKILL.md`        |   397 | plan mining, capture, and disposal                          |
| `~/.claude/hooks/lib/plan_hygiene.py`                |   228 | `STATUSES`, frontmatter status, active/bound plan functions |
| `~/.claude/hooks/lib/plan_lint.py`                   |   157 | frontmatter findings and lint entrypoints                   |
| `~/.claude/hooks/tests/test_plan_hygiene.py`         |   327 | plan-hygiene acceptance classes                             |
| `~/.claude/hooks/planning/stamp-plan-frontmatter.py` |   133 | `build_block`, `main`                                       |
| `~/.claude/hooks/planning/lint-plans.py`             |   102 | CLI and lint wrapper                                        |
| `~/.claude/hooks/planning/plan-review.py`            |    75 | ExitPlanMode review hook                                    |
| `~/.claude/hooks/README.md`                          |   204 | hook registry and plan-hygiene documentation                |
| `~/.claude/settings.json`                            |   309 | SessionStart, PreToolUse, PostToolUse, Stop                 |
| `~/.codex/sync-codex-skills.sh`                      |    88 | `CLAUDE_SKILLS_DIR`, `rsync`                                |

Additional pilot inspection confirmed:

- `.github/ISSUE_TEMPLATE/{config.yml,bug_report.yml,feature_request.yml}` exist.
- All three contain links to `minipuft/claude-prompts` that need correction.
- Bug and feature forms request the missing `triage` label.
- No `.github/DISCUSSION_TEMPLATE/` exists.
- Issues, Projects, and Discussions are enabled, but the active `gh` token lacks `read:project`.

**Path revision required**: no. The new skill, references, script, test file, and Discussion form are intentionally new paths.

## Step 4 — Implementation Tiers

### Tier 1 — Canonical Ownership and Minimal Global Contract

| #   | St  | File                                  | Change                                                                                                                                                          | ~Lines | Depends | Verify                           | Justification                                                           |
| --- | --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | ------- | -------------------------------- | ----------------------------------------------------------------------- |
| 1.1 | ✓   | `~/.claude/CLAUDE.md`                 | Add a compact GitHub-capability planning directive and `/github-planning` pointer; state that network detection occurs only at publish/retire/setup boundaries. |      4 | none    | `check-rules.sh`                 | Global behavior needs one visible trigger, not detailed workflow prose. |
| 1.2 | ✓   | `~/.claude/rules/dev-workflow.md`     | Add the action-boundary gate for publishing or retiring a decision-bearing plan in a GitHub-capable repo.                                                       |      5 | 1.1     | Rule and line-budget checks      | The workflow rule owns when skills fire.                                |
| 1.3 | ✓   | `~/.claude/rules/project-contract.md` | Add an optional planning-provider override with `auto` default and `off`/`local` exceptions.                                                                    |      6 | 1.1     | Project-contract scenario review | Project facts must override defaults without mandatory boilerplate.     |
| 1.4 | ✓   | `~/.claude/rules/ci-release.md`       | Point GitHub planning templates/bootstrap to `/github-planning` while retaining release ownership in `/release-engineering`.                                    |      4 | 1.1     | Rule checks                      | Prevent duplicated GitHub planning policy.                              |
| 1.5 | ✓   | `~/.claude/rules/_index.md`           | Update rule summaries and triggers.                                                                                                                             |      3 | 1.2-1.4 | Index validation                 | Existing index remains the catalog.                                     |
| 1.6 | ✓   | `~/.claude/skills/_index.md`          | Register `/github-planning` and its trigger phrases.                                                                                                            |      3 | 2.1     | Skill index validation           | Makes the on-demand workflow discoverable.                              |

**Tier 1 gate**: `~/.claude/scripts/check-rules.sh && python3 ~/.claude/hooks/skills/validate-indexes.py`

### Tier 2 — On-Demand GitHub Planning Capability

| #   | St  | File                                                           | Change                                                                                                                              | ~Lines | Depends | Verify                                        | Justification                                              |
| --- | --- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -----: | ------- | --------------------------------------------- | ---------------------------------------------------------- |
| 2.1 | ✓   | `~/.claude/skills/github-planning/SKILL.md`                    | Define triggers, lifecycle ownership, detection, exceptions, dry-run/apply safety, and reference routing.                           |    170 | 1.1     | Skill metadata and scenario review            | New domain keeps detailed guidance out of global context.  |
| 2.2 | ✓   | `~/.claude/skills/github-planning/references/lifecycle.md`     | Specify object transitions, ownership, tracking, retirement, and release-target semantics.                                          |    170 | 2.1     | Lifecycle scenario matrix                     | Detailed lifecycle reference should load only when needed. |
| 2.3 | ✓   | `~/.claude/skills/github-planning/references/project-setup.md` | Specify fields, views, labels, forms, permissions, recovery, and supported/manual boundaries.                                       |    190 | 2.1     | Official-doc comparison and dry-run checklist | Setup is a separate operational lookup surface.            |
| 2.4 | ✓   | `~/.claude/skills/github-planning/scripts/github_planning.py`  | Implement `detect`, `plan-setup`, `apply-setup`, and `validate`; cache read-only detection; discover IDs; require explicit writes.  |    360 | 2.2,2.3 | Stubbed unit tests and repeated dry-runs      | Deterministic automation cannot live in prose or hooks.    |
| 2.5 | ✓   | `~/.claude/hooks/tests/test_github_planning.py`                | Cover provider detection, cache, auth, disabled features, ID discovery, dry-run purity, idempotency, recovery, and fallback output. |    280 | 2.4     | Focused unittest suite                        | Provider automation has a distinct failure shape.          |

**Tier 2 gate**: `python3 -m unittest ~/.claude/hooks/tests/test_github_planning.py && python3 ~/.claude/hooks/skills/validate-indexes.py`

### Tier 3 — Plan Metadata and Local Enforcement

| #   | St  | File                                                 | Change                                                                                                               | ~Lines | Depends | Verify                          | Justification                                                |
| --- | --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -----: | ------- | ------------------------------- | ------------------------------------------------------------ |
| 3.1 | ✓   | `~/.claude/hooks/lib/plan_hygiene.py`                | Add optional tracking/reason parsing and exception vocabulary; leave `STATUSES` unchanged.                           |     55 | 2.2     | Focused unit tests              | Existing metadata primitives belong in this SSOT.            |
| 3.2 | ✓   | `~/.claude/hooks/lib/plan_lint.py`                   | Add pure URL-shape, exclusivity, reason-enum, and policy-mode checks without live lookup.                            |     65 | 3.1     | Valid/invalid/legacy fixtures   | Extend the existing structural linter.                       |
| 3.3 | ✓   | `~/.claude/hooks/tests/test_plan_hygiene.py`         | Add compatibility and metadata-validation cases; prove legacy four-field plans remain valid during advisory rollout. |    120 | 3.1,3.2 | Full hook unittest suite        | Existing hygiene suite owns metadata behavior.               |
| 3.4 | ✓   | `~/.claude/hooks/planning/stamp-plan-frontmatter.py` | Preserve the required four-field stamp and document provider fields as publish-boundary data.                        |      8 | 3.1     | Hook input/output fixture       | Avoid false provider data and startup network use.           |
| 3.5 | ✓   | `~/.claude/hooks/planning/lint-plans.py`             | Surface new local findings through the existing CLI and commit advisory path.                                        |     15 | 3.2     | CLI and staged-plan simulation  | Existing wrapper is the right local boundary.                |
| 3.6 | ✓   | `~/.claude/hooks/README.md`                          | Document metadata split, offline behavior, advisory rollout, and explicit live checks.                               |     25 | 3.1-3.5 | Documentation anchor check      | Hook behavior remains discoverable.                          |
| 3.7 | ✓   | `~/.claude/settings.json`                            | Verify-only: add no SessionStart GitHub command.                                                                     |      0 | 3.5     | Confirm no startup registration | Explicit zero-change boundary prevents always-on networking. |

**Tier 3 gate**: `python3 -m unittest discover ~/.claude/hooks/tests && python3 ~/.claude/hooks/planning/lint-plans.py --repo ~/.claude`

### Tier 4 — Existing Skill Integration and Client Synchronization

| #   | St  | File                                                                       | Change                                                                                                                                                                                             | ~Lines | Depends | Verify                                            | Justification                                                                                     |
| --- | --- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | ------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 4.1 | ✓   | `~/.claude/skills/plan/SKILL.md`                                           | Route publish, Issue linkage, exception, and retirement decisions to `/github-planning`; preserve Plan Medium.                                                                                     |     18 | 2.2,3.1 | Scenario review and index validation              | `/plan` owns authoring, not provider operations.                                                  |
| 4.2 | ✓   | `~/.claude/skills/git/SKILL.md`                                            | Add Issue-closing/linking expectations for branches and PRs; point Project updates to `/github-planning`.                                                                                          |     14 | 2.2     | PR examples                                       | `/git` owns delivery mechanics.                                                                   |
| 4.3 | ✓   | `~/.claude/skills/dev-workflow/SKILL.md`                                   | Add publish/retire checkpoints while preserving plan file as execution SSOT.                                                                                                                       |     16 | 2.2,3.2 | Route matrix                                      | Orchestration must call the new boundary.                                                         |
| 4.4 | ✓   | `~/.claude/skills/release-engineering/SKILL.md`                            | Add repository planning-capability/bootstrap pointer while retaining Release Please and CI ownership.                                                                                              |     12 | 2.3     | Bootstrap decision table                          | Coordinates domains without merging them.                                                         |
| 4.5 | ✓   | `~/.claude/skills/knowledge-capture/SKILL.md`                              | Preserve canonical Issue/ADR links when retiring a mined plan.                                                                                                                                     |     10 | 2.2     | Retirement scenario                               | Disposal must not erase durable history.                                                          |
| 4.6 | ✓   | `~/.codex/sync-codex-skills.sh` + `~/.claude/scripts/sync_codex_skills.py` | Replace destructive mirror synchronization with manifest-owned updates: preserve Codex-only files, exclude `.system`, abort on unowned or locally modified collisions, and keep pre-write backups. |    190 | 4.1-4.5 | focused unit tests, dry run, full hash comparison | Claude-managed skills remain canonical without treating the entire Codex catalog as Claude-owned. |

**Tier 4 gate**: `~/.claude/scripts/check-rules.sh && python3 ~/.claude/hooks/skills/validate-indexes.py && ~/.codex/sync-codex-skills.sh`

### Tier 5 — `claude-prompts-mcp` Pilot and Project Rollout

| #   | St                                                                                                       | File                                             | Change                                                                                                                    | ~Lines | Depends               | Verify                                                                            | Justification                                                       |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -----: | --------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 5.1 | ✓                                                                                                        | `.github/ISSUE_TEMPLATE/config.yml`              | Correct documentation and troubleshooting links to `minipuft/claude-prompts-mcp`.                                         |      4 | 2.3                   | YAML and repository-name check                                                    | Existing links target the wrong repository.                         |
| 5.2 | ✓                                                                                                        | `.github/ISSUE_TEMPLATE/bug_report.yml`          | Correct links and retain only labels validated or created by setup.                                                       |      4 | 2.3                   | YAML and live label validation                                                    | Repair the existing form.                                           |
| 5.3 | ✓                                                                                                        | `.github/ISSUE_TEMPLATE/feature_request.yml`     | Correct links and retain only labels validated or created by setup.                                                       |      4 | 2.3                   | YAML and live label validation                                                    | Repair the existing form.                                           |
| 5.4 | ✓                                                                                                        | `.github/DISCUSSION_TEMPLATE/idea.yml`           | Add structured unresolved-idea intake with decision criteria and conversion guidance.                                     |     75 | 2.2,2.3               | YAML/form/category validation                                                     | Native Discussion intake cannot be modeled by Issue forms.          |
| 5.5 | ✓                                                                                                        | GitHub remote state through `github_planning.py` | Apply the private repository profile: labels, Priority and Area fields, repository link, and six filtered views.          |      0 | 2.4,5.1-5.4,OQ-1,OQ-2 | Explicit apply succeeded; second dry-run is mutation-free; live validation passes | Remote state uses discovered IDs and a repository-specific profile. |
| 5.6 | ✓ (2026-08-23 · plan remains `active` and tracks accepted-work Issue #224; live Issue validation passes) | This plan                                        | On implementation start, change lifecycle to active and bind it to the accepted-work Issue; keep Project Status separate. |    2-3 | 3.1,5.5               | Local lint and live Issue validation                                              | This initiative becomes the first migration exemplar.               |

**Tier 5 gate**: `github_planning.py validate --repo minipuft/claude-prompts-mcp` plus local plan lint.

### Tier 6 — End-to-End Acceptance and Measured Rollout

| #   | St                                                                                                                                                                                | File                                     | Change                                                                                                                             | ~Lines | Depends      | Verify                                              | Justification                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -----: | ------------ | --------------------------------------------------- | -------------------------------------------------------------- |
| 6.1 | ☐ (as of 2026-08-23 · flips when PR #241 merges and closes #224; Discussion #225, Issue #224, Project #1, plan tracking, implementation, validation, and closing PR are retained) | Windows hook-interpreter RFC (#225/#224) | Live-drive one useful RFC through Discussion, Issue/sub-issues, Project fields, plan tracking, and PR linkage; retain the records. |      0 | 5.5,5.6,OQ-3 | Inspect every transition and canonical owner        | Fixtures cannot validate permissions or human-visible flow.    |
| 6.2 | ✓ (2026-08-23 · global suites, typecheck, lint ratchets, unit/integration tests, build, plugin E2E, and all 48 validation steps pass; evidence is recorded in the notes)          | Global suites and `server/` build        | Run rule/index/hook tests, typecheck, lint ratchet, test CI, and build; record evidence in implementation notes.                   |      0 | 6.1          | All commands pass                                   | Final acceptance needs deterministic and real-client evidence. |
| 6.3 | ✓ (2026-08-23 · sibling notes record deviations, rulings, auth/API constraints, validation evidence, pilot measurements, and remaining acceptance conditions)                     | Sibling implementation-notes file        | During execution, record deviations, rulings, auth/API constraints, validation ledger, and pilot measurements.                     |     40 | 6.1,6.2      | Plan-sync review                                    | Existing convention owns implementation evidence.              |
| 6.4 | ✓ (2026-08-23 · three repositories measured; enforcement remains advisory because opt-in setup state and disabled Discussions would create blocking false positives)              | `plan_lint.py` and `dev-workflow.md`     | After three independent pilots, decide whether to graduate publication enforcement from advisory.                                  |     10 | 6.3,OQ-4     | Evidence cites three repositories and updated tests | Enforcement strength follows measurement.                      |

**Tier 6 gate**: global and repository validation pass; live workflow is inspectable; repeated setup is clean; scope review finds no parallel tracker or startup network path.

## New File Justifications

| New file                                    | Why an existing file is insufficient                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `~/.claude/skills/github-planning/SKILL.md` | Dedicated on-demand behavior keeps global guidance small and preserves plan/git/release boundaries.            |
| `references/lifecycle.md`                   | Lifecycle semantics are detailed lookup material.                                                              |
| `references/project-setup.md`               | Setup, permissions, fields, views, and recovery are a separate operational concern.                            |
| `scripts/github_planning.py`                | Safe remote-state discovery and mutation require deterministic executable behavior.                            |
| `test_github_planning.py`                   | Provider automation has different fixtures and failure modes from plan hygiene.                                |
| `.github/DISCUSSION_TEMPLATE/idea.yml`      | GitHub Discussion intake is a provider-native artifact with no existing equivalent.                            |
| Sibling implementation-notes file           | Existing workflow requires deviations and validation evidence outside the plan contract once execution begins. |
| `hooks/python-hook-runner.cjs`              | Installed hook commands need one shell-independent boundary that resolves Python before existing hooks run.    |
| `hooks/tests/test_python_hook_runner.py`    | Registry-level regression coverage must prove every installed Python hook uses the portable launcher.          |

## Execution Dispatch

| Work                | Executor                       | Why                                                                                                          |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Tier 1              | Main thread                    | Ownership and always-loaded token budget are decision-bearing.                                               |
| Tier 2 references   | Bounded documentation executor | The lifecycle and setup contracts are bounded after ownership is ruled.                                      |
| Tier 2 script/tests | Bounded Python executor        | Focused stubbed-`gh` produce-and-measure loop.                                                               |
| Tier 3              | Main thread                    | Metadata compatibility and enforcement semantics are global policy.                                          |
| Tier 4              | Bounded mechanical executor    | Small explicit routing edits followed by canonical synchronization.                                          |
| Tier 5              | One serialized GitHub executor | All live mutations target one repository/Project and must not race.                                          |
| Tier 6              | Main thread                    | Gate verdicts, tier acceptance, open-question rulings, final live drive, and scope review are not delegated. |

## Open Questions

| ID   | Status             | Must precede | Decision                                                | Chosen default                                                                                                                                                  | Alternative                                                                                                    |
| ---- | ------------------ | ------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| OQ-1 | RULED              | Tier 5       | Authorization for live Project mutation                 | Expand `gh` authorization only with `read:project` and `project` during explicit apply after dry-run review.                                                    | Deliver validated scripts and defer live Project state.                                                        |
| OQ-2 | RULED              | Tier 5       | Pilot Project visibility                                | Private for setup validation; public only after the live drive passes.                                                                                          | Public at creation.                                                                                            |
| OQ-3 | REVISED 2026-08-15 | Tier 6       | Retained initiative for the live Discussion-to-PR drive | Windows hook-interpreter RFC: Discussion #225 → Issue #224. Supersedes the original "use this planning standard" ruling, which left the drive self-referential. | Use this GitHub-native planning standard (original ruling); or the next accepted `claude-prompts-mcp` feature. |
| OQ-4 | CLOSED 2026-08-23  | Tier 6.4     | Two additional advisory pilots                          | `claude-code-config` plus `repository-standards`; retain advisory enforcement after measuring setup-state conflation in both repositories.                      | Graduate to blocking enforcement.                                                                              |

Open-question rulings and rationales belong in the sibling implementation-notes file, not in this plan.

## Step 5 — Validation and Completion

### Testing Strategy

| What to test                                                              | Test type                                   | Location                      | Why this type                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------- | -------------------------------------------------------------------- |
| GitHub, non-GitHub, local override, and disabled-feature detection        | Pure unit with stubbed `gh` responses       | `test_github_planning.py`     | Deterministic branch coverage without network dependency.            |
| Cache hit, expiry, corruption, repo identity change, and offline fallback | Pure unit                                   | `test_github_planning.py`     | Cache is advisory and must fail safely.                              |
| Auth scope failure and redacted diagnostics                               | Pure unit                                   | `test_github_planning.py`     | Prevent secret leakage and misleading capability claims.             |
| Setup diff generation and explicit-apply requirement                      | Contract unit                               | `test_github_planning.py`     | Proves dry-run purity and mutation boundary.                         |
| Repeated apply and partial setup recovery                                 | Stateful fixture unit                       | `test_github_planning.py`     | Idempotency is the primary automation safety property.               |
| Tracking URL/reason syntax and legacy compatibility                       | Pure unit                                   | `test_plan_hygiene.py`        | Local plan checks must remain fast and network-free.                 |
| Existing hook behavior and status vocabulary                              | Regression suite                            | `~/.claude/hooks/tests/`      | Protects current plan hygiene and four lifecycle states.             |
| Rule/skill budgets and indexes                                            | Static validation                           | Existing rule/index scripts   | Prevents token growth and catalog drift.                             |
| Issue and Discussion forms                                                | YAML/schema plus live repository validation | `.github/*_TEMPLATE/`         | Local syntax does not prove labels/categories exist.                 |
| Project fields, views, labels, and repository link                        | Read-only live integration                  | `github_planning.py validate` | Remote state cannot be proven by fixtures alone.                     |
| Discussion -> Issue -> Project -> plan -> PR                              | Useful live drive                           | `claude-prompts-mcp`          | Validates permissions, ownership boundaries, and operator usability. |
| TypeScript repository health                                              | Typecheck, lint ratchet, tests, build       | `server/`                     | Pilot template/config work must not destabilize the repository.      |
| Codex synchronization                                                     | Dry-run, actual sync, checksum comparison   | `sync-codex-skills.sh`        | Confirms canonical-to-copied propagation without direct edits.       |

### Done Criteria

| Criterion                       | Validation                    | Pass condition                                                                                                                                        |
| ------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Minimal global trigger          | Rule diff and line count      | At most twelve non-index always-loaded lines; detail lives under `/github-planning`.                                                                  |
| Provider-aware activation       | Detection matrix              | Plain git is insufficient; verified GitHub capability activates; overrides and offline fallback work.                                                 |
| No startup networking           | `settings.json` and hook scan | No GitHub detection command registered for SessionStart.                                                                                              |
| One lifecycle model             | Ownership and code review     | Plan status remains document lifecycle; Issue and Project own accepted work and scheduling.                                                           |
| Backward-compatible frontmatter | Plan-hygiene tests            | Legacy four-field plans pass during advisory rollout.                                                                                                 |
| Safe setup                      | Two dry-runs around apply     | First dry-run is reviewable; writes require apply; second dry-run reports no changes.                                                                 |
| No opaque ID hardcoding         | Source scan and setup logs    | IDs originate only from discovery responses/cache.                                                                                                    |
| Useful Project                  | Live validation               | Priority plus the repository Area field exist; Inbox, Now, Backlog, Blocked, Releases, and Recently completed match the declared layouts and filters. |
| Repaired intake                 | Form validation               | Links target `claude-prompts-mcp`; referenced labels/categories exist.                                                                                |
| Cross-client consistency        | Sync verification             | Canonical Claude skills and copied Codex skills match after the existing sync.                                                                        |
| End-to-end traceability         | Live record inspection        | One retained workflow connects Discussion, accepted Issue, Project item, plan, and PR without duplicate canonical owners.                             |
| Repository health               | Global tests and npm commands | All required suites and build pass, or a pre-existing failure is documented with evidence and no regression.                                          |
| Measured enforcement decision   | Three-pilot review            | Blocking is adopted only with three independent successful pilots and acceptable false-positive results.                                              |
| Migration closeout              | Scope and lifecycle review    | No alternate tracker, temporary hook, duplicated script, stale copy, or unexplained active plan remains.                                              |

### Documentation

| Document                                                                                       | Update needed                                                                      |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `~/.claude/CLAUDE.md`                                                                          | Short global trigger and pointer only.                                             |
| `rules/dev-workflow.md`                                                                        | Publish/retire boundary.                                                           |
| `rules/project-contract.md`                                                                    | Optional provider override.                                                        |
| `rules/ci-release.md`                                                                          | Ownership pointer for repository planning assets.                                  |
| `rules/_index.md` and `skills/_index.md`                                                       | Catalog updates.                                                                   |
| `github-planning/SKILL.md`                                                                     | Entry workflow, safety contract, exceptions, routing.                              |
| `references/lifecycle.md`                                                                      | Full object lifecycle and ownership.                                               |
| `references/project-setup.md`                                                                  | Project, views, fields, labels, forms, permissions, recovery.                      |
| Existing `/plan`, `/git`, `/dev-workflow`, `/release-engineering`, `/knowledge-capture` skills | Short cross-domain pointers at their action boundaries.                            |
| `hooks/README.md`                                                                              | Structural/live split and no-startup-network rationale.                            |
| This plan                                                                                      | Tier status and lifecycle metadata during execution.                               |
| Sibling implementation notes                                                                   | Rulings, deviations, validation evidence, and pilot measurements during execution. |

### Risks

| Risk                                             | Impact | Mitigation                                                                           | Rollback                                                                       |
| ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Remote apply creates duplicate or public state   | High   | Dry-run default, discovered IDs, explicit apply, private pilot, serialized executor  | Disable automation; archive/remove only generated state after explicit review. |
| Active token lacks Project scopes                | High   | Detect scopes before setup and request minimum scopes only at apply                  | Defer live setup while retaining local plan workflow.                          |
| Project view mutation behavior changes           | Medium | Discover schema at runtime, cover setup in unit tests, and validate live after apply | Stop mutation and emit a precise manual recovery checklist.                    |
| New metadata breaks existing plans               | High   | Additive optional fields, advisory rollout, legacy fixtures                          | Disable new findings and retain four-field contract.                           |
| Network outage blocks ordinary planning          | High   | Boundary-only calls, cache, explicit offline/local reasons                           | Continue local plan lifecycle without provider operations.                     |
| Project Status duplicates plan status            | High   | Ownership table, separate vocabularies, tests/docs                                   | Remove any mapping and restore document-only plan status.                      |
| Global guidance becomes token-heavy              | Medium | Twelve-line budget and on-demand references                                          | Revert global prose to one pointer while retaining skill detail.               |
| Copied client skills drift                       | Medium | Edit canonical source only; sync and checksum                                        | Restore Codex backup generated by existing sync script.                        |
| Intake forms reference missing labels/categories | Medium | Validate before merge/apply and create or remove invalid references                  | Revert form label/category declarations.                                       |
| Live drive creates noise                         | Low    | Use this real initiative and retain it as useful history                             | Close/archive the test records with explanation if the flow is rejected.       |
| Blocking enforcement is premature                | High   | Advisory pilot and three-repository threshold                                        | Retain advisory mode.                                                          |

### Release

- **Commit convention**: `feat(docs): pilot GitHub-native planning lifecycle`
- **Scope**: `docs`
- **Changelog section**: Added
- **Changelog entry**: GitHub-native planning lifecycle with Discussion discovery, Issue tracking, repository-specific Project views, safe setup automation, and local/offline exceptions.

### Growth Capture

- [ ] Evaluate whether capability-bound publishing is a repeated pattern worth routing through `/knowledge-capture`.
- [ ] Record operator preferences or repository-specific facts in the appropriate memory layer.
- [ ] Capture any correction to plan lifecycle, GitHub object ownership, or setup safety in the owning skill.
- [ ] Log independent pilot sightings before promoting stronger global enforcement.
- [ ] Retire or reference the plan only after durable knowledge and canonical links are preserved.

## Validation Commands

Global configuration:

```bash
~/.claude/scripts/check-rules.sh
python3 ~/.claude/hooks/skills/validate-indexes.py
python3 -m unittest discover ~/.claude/hooks/tests
python3 ~/.claude/hooks/planning/lint-plans.py --repo ~/.claude
```

Client synchronization:

```bash
~/.codex/sync-codex-skills.sh
```

Pilot repository:

```bash
cd server
npm run typecheck
npm run lint:ratchet
npm run test:ci
npm run build
```

Remote state, after open questions are ruled and dry-run is reviewed:

```bash
python3 ~/.claude/skills/github-planning/scripts/github_planning.py plan-setup --repo minipuft/claude-prompts-mcp
python3 ~/.claude/skills/github-planning/scripts/github_planning.py apply-setup --repo minipuft/claude-prompts-mcp --apply
python3 ~/.claude/skills/github-planning/scripts/github_planning.py validate --repo minipuft/claude-prompts-mcp
```

## Completion Rule

The initiative is not complete when a Project merely exists. Completion requires one canonical lifecycle, safe repeatable setup, repaired intake forms, synchronized client guidance, a useful live trace from discovery through delivery, full validation evidence, and removal of any temporary or duplicate path. If any migration artifact remains, keep the plan active or open an explicit successor plan before retirement.
