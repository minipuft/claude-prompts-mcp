---
title: "Plan Retirement Federation — Tier F4"
date: 2026-08-03
status: backlog
tags: []
---

# Plan Retirement Federation — Tier F4

**Date**: 2026-08-03
**Area**: `scripts/retire-done-plans.js` → `minipuft/repository-standards`; consuming repos' CI
**Work type**: feature (extract local tooling into a shared, versioned contract)
**Origin**: plan-cleanup pass 2026-08-03; depends on the federation model in
[`downstream-standards-federation-2026-08-02.md`](../downstream-standards-federation-2026-08-02.md)
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

| #    | Status | Step                                                                           | Files                                                   | Depends | Verification                                                             |
| ---- | ------ | ------------------------------------------------------------------------------ | ------------------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| F4.1 | ☐      | Make link sources configurable, defaulting to nothing                          | `retire-done-plans.js`                                  | —       | No config → hard error naming the missing key, never a clean empty scan  |
| F4.2 | ☐      | Fail when a configured link source does not exist on disk                      | `retire-done-plans.js`                                  | F4.1    | Back-test: point a source at a missing dir → exit 1, not "0 findings"    |
| F4.3 | ✓      | Publish the frontmatter convention to the standards repo as the citable source | `repository-standards`                                  | —       | Script and docs cite a public path; no `~/knowledge-hub` path in either  |
| F4.4 | ☐      | Move the script to the standards repo, versioned                               | `repository-standards`                                  | F4.1-3  | Tagged release; this repo consumes a pinned version                      |
| F4.5 | ☐      | Reusable workflow consumers call from their release PR                         | `repository-standards/.github/workflows`                | F4.4    | This repo's release-please step calls it and behaves identically         |
| F4.6 | ☐      | Migrate this repo to the shared version; delete the local copy                 | `scripts/`, `server/package.json`, `release-please.yml` | F4.5    | Queue still 7/0; back-test still exits 1 on a misclassified plan         |
| F4.7 | ☐      | Onboard one second project as the generalization proof                         | one sibling repo                                        | F4.6    | Its queue is correct **and** its back-test fails on a seeded misclassify |

**Gate**: a second repository retires its own finished plans through the shared workflow, and a
deliberately misclassified plan in that repo fails its CI — proving the check measures there, not
merely that it runs.

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

**F4.7 is the real gate, not F4.6.** Migrating this repo proves the extraction did not break the
place it already worked. Only a second repo proves it generalizes, and only a seeded failure there
proves the check is live rather than vacuous.

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

---

## Execution notes — F4.3 (2026-08-03)

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
