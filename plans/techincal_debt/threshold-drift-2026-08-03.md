---
title: "Threshold Drift — Tier F3"
date: 2026-08-03
status: done
tags: []
---

# Threshold Drift — Tier F3

**Date**: 2026-08-03
**Area**: `~/.claude/skills/code-architecture/`, `~/.claude/skills/dev-workflow/`,
`~/.claude/skills/refactoring/scripts/`, `~/.claude/skills/codebase-maintenance/scripts/`,
and the `tier_execute` MCP prompt (served from the plugin bundle — edit via `resource_manager`)
**Work type**: refactor (rule/guidance correction)
**Origin**: rules audit 2026-08-03, finding F3
**Confidence**: high — every stale site was located by literal grep and quoted below

---

## The defect

On 2026-08-02 two thresholds were **deliberately deleted**, each with reasoning recorded in
`refactoring.md` and `Applications/CLAUDE.md`:

- **Per-layer line ceilings** — "splitting it to satisfy a number produces a file whose only
  justification is arithmetic, plus an import to trace"
- **The cyclomatic complexity gate** — "it counts every `??` and `?.` as a branch, so idiomatic
  optional chaining inflates it without costing a reader anything"

**Neither removal propagated past `rules/`.** Skills, their shell scripts, and the `tier_execute`
MCP prompt still assert both, and the prompt asserts them as a **write-block**.

This is not cosmetic. `tier_execute` ran four times on 2026-08-03 and each run instructed:

> "Layer size budgets (project CLAUDE.md): orchestration 50-125 (max 150), services 200-400
> (max 600), utilities 50-150 (max 200) — **write-block if exceeded**"
> "complexity ≤15 cognitive / **≤10 cyclomatic**"

Those runs happened to be steered by an operator who had read `refactoring.md`. A run that
trusted the prompt would split a cohesive file to satisfy a number that no longer exists — the
precise behaviour both removals were written to stop. Fossil evidence already exists in the
codebase: `gate-set-resolver.ts:387` carries a comment reasoning about "cyclomatic 12 against a
limit of 10".

**The rule layer and the execution layer disagree, and the execution layer is the one that fires.**

## Inventory (measured 2026-08-03 — re-measure before editing)

| Site                                                          | Stale assertion                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| `skills/code-architecture/SKILL.md:28,32,36`                  | layer line ranges in the layer diagram                       |
| `skills/code-architecture/SKILL.md:48,55,61`                  | "Size: 50-150 / 200-600 / 50-200 lines" in the decision tree |
| `skills/code-architecture/SKILL.md:299`                       | "God service (>600 lines, 10+ methods)" anti-pattern         |
| `skills/code-architecture/scripts/check-layers.sh:247,254`    | warns on `50-125` / `200-400`                                |
| `skills/refactoring/scripts/pre-flight.sh:126`                | `ADVISORY="50-150"`                                          |
| `skills/refactoring/scripts/pre-flight.sh:6`                  | header claims cyclomatic is checked                          |
| `skills/codebase-maintenance/scripts/check-health.sh:143`     | ">600 lines — service advisory threshold"                    |
| `skills/dev-workflow/gates/workflow-preflight/guidance.md:10` | "Cognitive complexity ≤15, cyclomatic ≤10"                   |
| `skills/dev-workflow/gates/workflow-preflight/gate.yaml:21`   | matches `'cognitive\|cyclomatic'`                            |
| `tier_execute` MCP prompt, Phase 3                            | both, as a write-block                                       |

## Subtiers

| #    | Status | Step                                                                             | Files                                                 | Depends | Verification                                                   |
| ---- | ------ | -------------------------------------------------------------------------------- | ----------------------------------------------------- | ------- | -------------------------------------------------------------- |
| F3.1 | ✓      | Re-measure the inventory — it is hours old and the grep is cheap                 | —                                                     | —       | Literal grep output, not a re-read of the table above          |
| F3.2 | ✓      | Replace size ceilings with the responsibility question in the architecture skill | `skills/code-architecture/SKILL.md`                   | F3.1    | No line-range survives as a threshold; `rg '200-600'` → 0      |
| F3.3 | ✓      | Drop the cyclomatic gate from the dev-workflow pre-flight gate                   | `skills/dev-workflow/gates/workflow-preflight/*`      | F3.1    | `rg cyclomatic` → 0 in that gate                               |
| F3.4 | ✓      | Fix the three shell scripts that warn on deleted numbers                         | `check-layers.sh`, `pre-flight.sh`, `check-health.sh` | F3.1    | Each script runs and emits no size-threshold warning           |
| F3.5 | ✓      | Correct the `tier_execute` prompt via `resource_manager` — never by hand         | MCP prompt resource                                   | F3.2-4  | Re-invoking the prompt shows neither threshold                 |
| F3.6 | ✓      | Leave one pointer per site to the owning rule so the next drift is visible       | all touched files                                     | F3.5    | Each edited site names `refactoring.md` as the threshold owner |

**Gate**: `rg '50-125|200-400|200-600|50-200|max 600|cyclomatic'` over `~/.claude/skills/` and the
served `tier_execute` prompt returns only deliberate prose about _why_ the thresholds were removed
— zero live assertions, zero write-blocks.

## Risks

**Low blast radius, but two real traps.**

**`server/prompts/**` is edit-forbidden by project rule — MCP tooling only.** F3.5 must go through
`resource_manager`. Hand-editing the prompt would violate Core Principle 1 and be silently
overwritten.

**Deleting a threshold is not the same as deleting the guidance.** The size question still has
value as a _diagnostic_ — `refactoring.md` keeps "how many responsibilities does it hold?" and a

> 1000-line Critical. F3.2 must replace, not merely remove; a skill that says nothing about size
> loses the signal along with the false gate.

## Rejected alternatives

- **Leave the skills alone since `rules/` wins by precedence** — precedence resolves conflicts for
  a reader who notices one. The `tier_execute` prompt is consumed as instructions, not adjudicated
  against the rule layer, and it says _write-block_.
- **Delete the size sections outright** — throws away the responsibility diagnostic that survived
  the 2026-08-02 revision on purpose.
- **Add a `validate:rule-references` check first** — worth doing (see below) but it is a different
  tier, and mechanising the check before fixing the known drift leaves the drift live longer.

## Follow-on (not this tier)

All three findings in the 2026-08-03 audit failed identically: a rule referenced a proxy, a
threshold, or a method name, and nothing verified the referent still existed. `check-rules.sh`
enforces budgets and forbidden words but cannot catch this. A `validate:rule-references` check
could — matrix method names are mechanically greppable, and a duplicated threshold is findable by
literal.

---

## Execution notes (2026-08-03)

### The inventory was wrong twice, in opposite directions

F3.1 re-measured and found **14 stale sites, not the 11 the plan listed** —
`check-layers.sh:259` and `pre-flight.sh:130,134` were missing. Standard drift; the re-measure
step exists for this.

The second miss was worse. The Phase 5 gate check surfaced a **second dev-workflow skill
directory** that F3.1's sweep had not reported: `skills/dev_workflow/` (underscore) alongside the
git-tracked `skills/dev-workflow/` (hyphen). Three stale sites lived in the copy I had not
touched, including `SKILL.md:208`.

`git check-ignore` returns non-zero for it, so it is not gitignored, and `git status` shows it as
`?? skills/dev_workflow/` — untracked. The most likely explanation is that it materialized during
this session (the skill listing began advertising `dev_workflow` partway through), rather than
`rg` having a blind spot. **I did not confirm the cause and am not claiming one.**

What matters for the tier: the gate caught it, both copies are now fixed, and the lesson is that a
`rg`-based inventory is a claim about one moment, not a standing fact. The gate re-check is what
made it a measurement.

### Scope grew by two items, both justified

**`pre-flight.sh:158` hard-failed any orchestration file with any private method** —
`fail "3" "$FNAME (orchestration) has $PRIVATE_HELPERS private helper(s)"`. That is the mechanical
arm of the rule narrowed earlier today in `architecture.md`, and it would have failed
`12-framework-stage.ts`, whose four remaining private methods are the async load, an input mapper,
and two coordinators. Left alone, the narrowed rule would have been contradicted by a script that
still blocked. Now a warning that asks the diagnostic question instead of counting.

**`check-layers.sh` did not warn, it failed** — `fail "$FNAME: $FLINES lines (orchestration limit:
150)"` and the same at 600 for services. The plan recorded these as advisories; they were hard
blocks on thresholds deleted 2026-08-02.

**The `tier_execute` prompt also carried the stale validation minimum** (F4's finding), naming
`npm run lint` and treating `validate:all` as optional. Fixed in the same `resource_manager`
update, since it is the same defect class — a prompt restating rules that moved on.

### What the prompt no longer restates

The edit does not just correct the numbers; it removes the duplication that let them drift.
Phase 3 now points at `refactoring.md` and says "do not restate numbers here". A copied threshold
is a threshold that will go stale again.

Two additions came from this session's failures rather than the drift itself: Phase 1 now says to
re-measure any inventory the tier asserts, and the anti-pattern list gains "splitting a cohesive
file to satisfy a line count".

### Verification

`grep -rn` over `~/.claude/skills/` for every removed threshold returns only deliberate prose
about why each was removed. All three edited shell scripts pass `bash -n`. The served
`tier_execute` prompt was re-inspected after the update and carries neither threshold.

---

## Correction: F3.3's first gate reading was invalid (2026-08-03, same day)

**The gate measured the wrong layer, and I marked the tier ✓ on it.**

F3.3 edited `~/.claude/skills/.../workflow-preflight/`. `docs/guides/skills-sync.md` states that
prompts in `server/resources/` are **the single source of truth** and Skills Sync _compiles_ them
into each client's format. Everything under `~/.claude/skills/` for a registered skill is therefore
a build artifact. The real source — `server/resources/gates/workflow-preflight/` — still carried
`cyclomatic ≤10` and "File within layer advisory range" after F3.3 "passed".

The next `npm run skills:export` would have regenerated the regression, and the gate would still
have read green, because its check greps `~/.claude/skills/` only.

This is the same failure shape as `ChainStepPrompt.inlineGateIds` earlier the same day: a check
that resolves the wrong referent and reports confidently. There the detector resolved a structural
alias instead of the real interface; here the gate resolved compiled output instead of its source.
**A green check is only worth what its referent is worth.**

### What actually fixed it

- The gate SSOT (`server/resources/gates/workflow-preflight/`) was corrected directly —
  `guidance.md` prose and the `'cognitive|cyclomatic'` → `'cognitive'` pattern — followed by
  `resource_manager action:"reload"`.
- The prompt SSOT (`server/resources/prompts/development/dev_workflow/`) was corrected, since
  `user-message.md` carried the same two lines.
- Both skill directories were reverted; the compiled one was regenerated by `skills:export` and
  verified to contain neither threshold.

### Two `resource_manager` defects found while doing it

- **Gate `update` replaces rather than merges.** Passing only `guidance` silently dropped
  `severity`, `pass_criteria`, `retry_config`, and `activation`. `severity` is absent from the
  tool's input schema, so it cannot be restored through the tool at all.
- **`action:"rollback"` is not an undo for the write that preceded it.** The version snapshot is
  taken _after_ the write, so rolling back to "version 1" restored the damaged state. Recovery was
  `git checkout` plus `reload`.

Gate edits were therefore made as surgical file writes plus explicit `reload`. The project rule
that would normally forbid this names `server/prompts/**` — **a path that no longer exists**;
resources moved to `server/resources/`. That stale path belongs to the same drift family this
tier documents.

### Status

F3.1-F3.2, F3.4-F3.6 stand. **F3.3 is complete only as of this correction**, not as of the
original gate reading.
