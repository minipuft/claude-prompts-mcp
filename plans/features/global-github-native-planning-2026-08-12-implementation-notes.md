---
title: Global GitHub-Native Planning and Task Management — Implementation Notes
date: 2026-08-13
status: active
tags:
  - planning
  - github
  - global-config
---

# Global GitHub-Native Planning and Task Management — Implementation Notes

Companion: [`global-github-native-planning-2026-08-12.md`](global-github-native-planning-2026-08-12.md)

## Open-question rulings

| ID   | Ruling                                                                                          | Rationale                                                                                |
| ---- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| OQ-1 | Request `read:project` and `project` only at explicit apply after dry-run review.               | Local implementation and read-only detection do not justify durable mutation permission. |
| OQ-2 | Create the pilot Project as private.                                                            | Visibility changes remain reversible after the live drive.                               |
| OQ-3 | Use this initiative for the retained lifecycle drive.                                           | It is real accepted work and avoids synthetic tracker noise.                             |
| OQ-4 | Pilot in `claude-code-config` and the next active GitHub repository; keep enforcement advisory. | Blocking needs three independent successful observations.                                |

## Deviations

| ID       | Tier | Plan assumption                                              | Evidence and ruling                                                                                                                                                                      | Consequence                                                                                                                                                              |
| -------- | ---: | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DEV-T1-1 |    1 | The planning document would remain in `~/.claude/plans`.     | The operator requested the durable plan under this repository's `plans/` tree.                                                                                                           | This file is canonical; the untracked global copy is removed after validation.                                                                                           |
| DEV-T1-2 |  1–4 | Global edits would run in an isolated clone.                 | The operator authorized direct edits on the live `~/.claude` main branch and canonical Codex synchronization.                                                                            | Preserve pre-existing dirty changes and stage/commit only initiative-owned paths.                                                                                        |
| DEV-T5-1 |    5 | Local and remote pilot setup could be one tier.              | GitHub Project writes are durable and cannot be isolated through git.                                                                                                                    | Implement and validate dry-run behavior now; defer `--apply` until review.                                                                                               |
| DEV-T5-2 |    5 | The planned `planning` commit scope was valid.               | Repository commitlint rejected it because the scope enum has no `planning` value.                                                                                                        | Use the existing `docs` scope for plan and intake-surface changes.                                                                                                       |
| DEV-T4-1 |    4 | The existing Codex sync was a safe canonical-copy operation. | The first post-change backup proved that `rsync --delete` replaced 108 destination skills with 54 Claude skills: 105 Codex-only entries were removed and three shared names overwritten. | Tier 4 acceptance was invalidated, then remediated with manifest-owned, conflict-aborting synchronization; the stale full export remains inactive in a forensic archive. |

## Validation ledger

| Surface               | Command                                                                                              | Result                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global rule budgets   | `~/.claude/scripts/check-rules.sh`                                                                   | PASS; unrelated pre-existing soft warnings only                                                                                                           |
| Skill/rule catalog    | `validate-indexes.py`                                                                                | INITIATIVE PASS; reports unrelated untracked `codex-plugins` and `diffusion-lora-bake` work from another session                                          |
| Global hook suite     | `python3 -m unittest discover ~/.claude/hooks/tests`                                                 | PASS: 52 tests                                                                                                                                            |
| Provider unit suite   | `test_github_planning.py`                                                                            | PASS: 14 tests                                                                                                                                            |
| Local plan lint       | `lint-plans.py` on this plan and notes                                                               | PASS                                                                                                                                                      |
| Capability detection  | `github_planning.py detect --no-cache`                                                               | PASS: GitHub, Issues/Projects/Discussions enabled; Project scopes absent                                                                                  |
| Setup dry run         | `github_planning.py plan-setup --no-cache`                                                           | PASS: proposes `triage` and private Roadmap; discovers Ideas category; no mutation                                                                        |
| Apply guards          | missing `--apply`; missing `project` scope                                                           | PASS: both exit 2 before mutation                                                                                                                         |
| Pilot forms           | Prettier, YAML parse, repository-link scan, live labels/categories                                   | PASS                                                                                                                                                      |
| Codex synchronization | six focused ownership tests, live dry run, archive inventory, and full non-system SHA-256 comparison | PASS: 286 Claude-managed files match; destination-only files are preserved by contract; 79 prompt/19 gate/6 methodology/4 style exports archived inactive |
| Pilot typecheck       | `npm run typecheck`                                                                                  | PASS                                                                                                                                                      |
| Pilot lint            | `npm run lint:ratchet`                                                                               | PASS: no regression                                                                                                                                       |
| Pilot tests           | `npm run test:ci`                                                                                    | PASS: 190 suites / 2480 tests                                                                                                                             |
| Pilot build           | `npm run build`                                                                                      | PASS                                                                                                                                                      |
| Changelog             | `[Unreleased]` Added entry                                                                           | PASS                                                                                                                                                      |

## Current boundary

Tiers 1–4 and local pilot tasks 5.1–5.4 are complete. Tier 5.5 remains open at the reviewed
dry-run boundary because the active token lacks `read:project` and `project`; no GitHub label,
Project, field, view, Discussion, or Issue was created. Tier 5.6 remains open until the accepted-work
Issue exists and this plan receives its canonical tracking URL.

Tier 4's Codex synchronization acceptance was re-opened after the operator noticed the skill catalog
had contracted. Remediation is complete: the pre-sync full export is inactive under
`~/.codex/skills-archive/claude-prompts-full-export-20260227`, `/mcp-prompt-router` routes on demand
to canonical MCP resources, and synchronization now updates only manifest-owned files while refusing
unowned collisions. The separate dirty `codex-prompts` checkout was not edited.

## Remaining closeout

- Review the remote setup dry run.
- Authorize minimum Project scopes and explicit apply.
- Complete the retained Discussion → Issue → Project → plan → PR drive.
- Repeat two advisory pilots before considering blocking enforcement.
