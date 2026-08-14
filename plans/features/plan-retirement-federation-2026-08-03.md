---
title: "Plan Retirement Federation — Tier F4"
date: 2026-08-03
status: backlog
tags: []
---

# Plan Retirement Federation — Tier F4

**Date**: 2026-08-03
**Area**: `scripts/retire-done-plans.js` → `minipuft/repository-standards`; invoked as a script by
every plan-bearing repo, and additionally from CI in the one that has any
**Work type**: feature (extract local tooling into a shared, versioned contract)
**Origin**: plan-cleanup pass 2026-08-03; depends on the federation model in
[`downstream-standards-federation-2026-08-02.md`](../reference/downstream-standards-federation-2026-08-02.md)
**Confidence**: medium — the mechanism is proven in one repo; generalization is the unproven half

---

## Why federate at all

`retire-done-plans.js` works here and is useless everywhere else, because `LINK_SOURCES` is a
hardcoded list of _this_ repo's directories:

```js
const LINK_SOURCES = [
  "plans",
  "docs",
  "server/src",
  "server/scripts",
  ".github",
];
```

Six projects share the plan-frontmatter convention through hub symlinks. One of them can retire
finished plans. Copying the script into the other five would create five copies drifting from each
other — the exact failure this session spent a day fixing in three other places (thresholds in
skills, method names in a matrix, a proxy standing in for an invariant).

### Who actually needs this (measured 2026-08-04, against remotes — not local clones)

| Class                                                       | Repos                                                         | Plans | `done` |
| ----------------------------------------------------------- | ------------------------------------------------------------- | ----: | -----: |
| CI **and** standards consumer (`consumer-contract.yml`)     | gemini-prompts, opencode-prompts, minipuft-plugins            |     0 |      0 |
| CI, has plans, not a consumer                               | claude-prompts-mcp                                            |    35 |      7 |
| **No CI at all** — no remote, or a remote with no workflows | cloudySky, portfolio, chatUI, mediaFlow, claude-prompts-media |   143 | **51** |

**88% of finished plans live in repos no workflow can reach.** cloudySky alone holds 49 of the 58,
has no remote, and originated the convention. Its `done` pile is the clearest evidence the
mechanism is needed and the clearest proof a CI-shaped delivery cannot supply it.

The delivery model therefore inverts: the **script** is the product, and the reusable workflow is
optional packaging for the single repo that can call one. See §Correction below — this plan was
written the other way round.

## The danger this tier exists to contain

**A false negative deletes something still referenced.**

The check asks "does anything cite this plan?" and answers by scanning `LINK_SOURCES`. In a repo
whose layout does not match, the scan finds nothing, reports a clean queue, and archives plans an
ADR still points at. **It fails silently and destructively, in that order.**

That asymmetry drives every decision below:

|          | False positive                | False negative                          |
| -------- | ----------------------------- | --------------------------------------- |
| Cause    | A plan named in passing prose | Link sources misconfigured or missing   |
| Effect   | Plan not archived             | Plan archived while still cited         |
| Recovery | Re-run next release           | Restore from git, fix every broken link |

So: **configuration absence must be an error, never an empty scan.**

## Subtiers

| #    | Status | Step                                                                           | Files                                                   | Depends | Verification                                                            |
| ---- | ------ | ------------------------------------------------------------------------------ | ------------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| F4.1 | ☐      | Make link sources configurable, defaulting to nothing                          | `retire-done-plans.js`                                  | —       | No config → hard error naming the missing key, never a clean empty scan |
| F4.2 | ☐      | Fail when a configured link source does not exist on disk                      | `retire-done-plans.js`                                  | F4.1    | Back-test: point a source at a missing dir → exit 1, not "0 findings"   |
| F4.3 | ✓      | Publish the frontmatter convention to the standards repo as the citable source | `repository-standards`                                  | —       | Script and docs cite a public path; no `~/knowledge-hub` path in either |
| F4.4 | ☐      | Move the script to the standards repo, versioned, runnable with no CI          | `repository-standards`                                  | F4.1-3  | Tagged release; runs from a clone in a repo with no workflows           |
| F4.5 | ☐      | Migrate this repo to the shared version; delete the local copy                 | `scripts/`, `server/package.json`, `release-please.yml` | F4.4    | Queue still 7/0; back-test still exits 1 on a misclassified plan        |
| F4.6 | ☐      | Onboard **cloudySky** — 131 plans, 49 `done`, no remote, no CI                 | cloudySky `plans/`, its release routine                 | F4.5    | Its queue is correct **and** a seeded misclassification exits 1         |
| F4.7 | ☐      | _Optional_ — reusable workflow for the one repo that has CI                    | `repository-standards/.github/workflows`                | F4.5    | This repo's release-please step calls it and behaves identically        |

**Gate**: cloudySky retires its own finished plans by running the shared script, and a deliberately
misclassified plan there exits 1 — proving the check measures in a repo with a different layout and
no CI, not merely that it runs where it was written.

**F4.7 is last and optional on purpose.** It serves one repository out of six. Building it before
F4.6 would prove the mechanism works in the environment it already worked in, which is not a
generalization proof — and it would leave the 51 finished plans it structurally cannot reach
exactly where they are.

## Decisions

**Config lives in the consuming repo, not the standards repo.** Only the consumer knows its own
layout. The standards repo owns the mechanism and the contract; a central registry of six repos'
directory structures would go stale the first time one reorganized.

**Default to nothing, not to a guess.** A default like `['docs', 'src']` would appear to work in a
repo that uses neither, which is the silent-destructive path. Absent config is a hard error.

**Publish the convention, keep the content.** The 4-field schema, the status vocabulary, and the
inbound-link test carry no project information. Decisions, lessons, plans, and the hub's mount
points do, and none of them move. The hub already enforces this structurally by gitignoring
`plans/`; F4.3 must not weaken it.

**`repository-standards` stays public.** Its purpose is downstream consumption, and private
reusable workflows add friction for no gain here — the leak boundary is what content crosses, not
whether the mechanism is visible.

## Risks

**Medium-high, concentrated in F4.1-F4.2.** Everything else is packaging.

The mitigation is that both subtiers are back-testable: seed a misclassified plan, confirm exit 1.
A check that has only ever passed has not been shown to measure anything — established twice today,
once when a detector watched the wrong interface and once when a gate measured compiled output
instead of its source.

**F4.6 is the real gate, not F4.5.** Migrating this repo proves the extraction did not break the
place it already worked. Only cloudySky proves it generalizes — different layout, no CI, and the
only pile large enough for a wrong archive to hurt — and only a seeded failure there proves the
check is live rather than vacuous.

**cloudySky raises the blast radius.** 131 plans against this repo's 35, and 49 `done` against 7.
A misconfigured `LINK_SOURCES` there archives an order of magnitude more, in a repo with no remote
to restore from beyond local git. F4.1's "absent configuration is an error" is written for exactly
that repo; do not relax it to make onboarding smoother.

## Rejected alternatives

- **Copy the script into each repo** — five drifting copies; the failure mode this session spent a
  day repairing elsewhere.
- **Central config listing every repo's layout** — the standards repo would need updating whenever
  any consumer reorganizes, and nothing would catch the staleness until a plan was wrongly archived.
- **Sensible defaults for link sources** — the one design that turns a misconfiguration into a
  silent deletion rather than an error.
- **Run it in `knowledge-hub` instead** — the hub gitignores `plans/` because they are machine-local
  symlink mount points, so CI there has nothing to scan. `check-plans.py` already states it is
  deliberately not a per-repo CI gate for the same reason.
- **Make `repository-standards` private** — undermines its purpose; the boundary that matters is
  content, and that is already enforced by the hub's `.gitignore`.
- **Ship it as a reusable workflow first** — see §Correction. It reaches one of the six
  plan-bearing repos and none of the three holding 88% of the finished plans.
- **Register the plan-bearing repos as standards consumers to make the workflow reach them** —
  three of them have no remote at all, so there is nothing to register. Of the two that do have
  remotes (portfolio, mediaFlow), neither has any `.github/workflows`, so joining the fleet would
  mean standing up CI in order to run a check they could run directly. The disclosure is minor —
  both are already public — but the mechanism would be built backwards.

---

## Correction — the delivery model was wrong (2026-08-04)

**Written for the fleet I had been working in, not for the repos that have plans.**

F4.4–F4.7 originally moved the script into `repository-standards` and had consumers call a
reusable workflow from their release PR. That assumed the standards consumers and the plan-bearing
repos were the same set. They are disjoint, and I never checked: the two facts came from different
places and were joined on a name that matched in my head.

Measured against remotes on 2026-08-04, the three registered consumers hold **zero** plans, while
51 of the 58 finished plans sit in five repos with no CI to call anything — three with no remote at
all, and two whose remotes have no `.github/workflows`. I had also assumed a remote implied CI;
portfolio and mediaFlow disprove that.

**What changed**: the script became the product and the workflow became optional packaging (F4.7,
demoted and made last). The generalization gate moved from "one sibling repo" to **cloudySky**
specifically — the largest pile, a different layout, no CI, and the repo the convention came from.

**What did not change**: F4.1 and F4.2. Configurable link sources with no default are correct under
either delivery model, and the false-negative asymmetry that motivates them is unaffected. The
error was in how the mechanism reaches repos, never in what the mechanism does.

**Cost of the error**: none in code — the delivery subtiers had not been started. It would have
been expensive after F4.7, which is the argument for re-measuring a plan's premises at execution
time rather than trusting the state they were authored in.

---

## Execution note — local hardening the extraction must carry (2026-08-12)

`--apply` gained a fail-closed git-cleanliness guard: it refuses to archive a `done` plan that
`git status --porcelain` reports untracked or modified, because `plans/archive/` is gitignored and
git history is the only surviving copy. `reference` relocations are deliberately unguarded
(tracked → tracked, nothing lost). Self-test covers untracked/modified/committed; documented in
`docs/guides/release-process.md`. This unlocked the between-release cadence (run at phase
completion; release PR stays the backstop) — 23 plans retired by hand on 2026-08-12 under it.
F4.4 must move this guard with the script: it is what makes hand-run `--apply` safe in repos with
no CI, which is most of the fleet this plan targets.

## Execution notes — F4.3 (2026-08-03) — RESOLVED

F4.3 landed: the frontmatter convention is published at `repository-standards`
(`conventions/plan-frontmatter.md`, commit `a57a767`) and both citation sites point at that
public path. Notes below are the record of how, not open work.

### The leak fix had landed half-done

`f6de2eca` removed the `~/knowledge-hub` citations and stopped there. F4.3's verification has two
clauses, and only the negative one ("no private path") was satisfied; the positive one ("cite a
public path") was not. Both sites had been re-pointed at `docs/guides/release-process.md`, which
resolves in this repo and nowhere else — so the moment F4.4 moves the script, its failure message
would cite a document none of the five consumers have.

Removing a bad citation is not the same as supplying a good one. The re-measure step is what
caught it; the plan's own row would have read as satisfied.

### Published subset, and what was withheld

`repository-standards/conventions/plan-frontmatter.md` (commit `a57a767`) carries the four-field
schema, the status vocabulary, the mechanical `done`/`reference` test, and the three-step
retirement contract including the false-negative asymmetry — so a consumer implementing this
independently does not have to rediscover the silent-deletion path.

Withheld: vault paths, `gen-board.py` / `check-plans.py` / `sync.py`, the board artifact, the
symlink mount architecture, and the two 2026-08-02 vault incidents. Also dropped the source doc's
"Established by cloudySky" attribution — `fleet.json` publicly registers four repositories and
that project is not among them, so the line would have disclosed a name the public repo does not
otherwise carry.

Verified by fetching the cited URL after pushing (HTTP 200 on both the raw and blob paths). A
citation is only worth what it resolves to.

### The convention was about to have three homes

Publishing without deleting would have left the schema restated in the standards repo, the vault,
and this repo's release guide. That is the drift shape this session repaired three times already.
Each site now owns exactly one thing: the standards repo owns the convention, the vault owns board
behaviour and how it commits, `docs/guides/release-process.md` owns how **this** repo runs
retirement.

### Two corrections outside the tier's stated scope

**The vault asserted its own remote was public, in three places** — `sync.py` usage text, its
`--push` argparse help, and `meta/plan-frontmatter.md`. `gh repo view` reports `isPrivate: true`.
That documented falsehood gates the push decision every time it is read, and it stranded four
commits the previous session. Corrected in all three. The same file also justified keeping the
convention out of project CI on the grounds that "a contributor without the hub checked out"
could not reach the definition — a reason publishing dissolves, so it was rewritten rather than
left contradicting a section two screens above it.

**`validate:documented-options` was red, and partly from this feature.** Its ground truth was the
two `parseArgs` tables in `server/src/runtime/cli.ts` and `cli/src/cli.ts`, but the docs also name
flags belonging to roughly thirty first-party scripts that test `argv` directly — so `--apply`
(introduced by `cbdfeae1`, this feature's own docs) and `--output-dir` (older) both read as
unbacked. Premise correct, referent too narrow: the same shape as the detector that watched the
wrong interface and the gate that read compiled output. Fixed by harvesting the declaration
idioms from `scripts/` and `server/scripts/`, restricted to those idioms rather than every
`'--x'` literal — scripts shell out to other tools, and harvesting `execFileSync('rg', ['--no-heading'])`
would let the docs claim ripgrep's flags as ours. The two ground-truth sources are checked for
emptiness separately so a working harvester cannot mask a broken one.

### Verification

Both changed behaviours were back-tested against a known-bad state, not merely re-run: the retire
script still exits 1 on a `done` plan that `docs/` cites, and the validator still catches a
fabricated `--nonexistent-flag`. The standards repo's own `npm run validate` passes.

`validate:all` is **not** green, for two causes outside this work and deliberately left alone:
`validate:format` (another session's working-tree edit to `README.md`, plus three files it deleted
that remain in the format glob) and `validate:no-methodology-vocab` (two comments committed at
HEAD in `d27bafaa`). Every other step passes; the retirement queue is unchanged at 7 `done` / 0
misclassified.
