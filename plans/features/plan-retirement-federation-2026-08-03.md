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
| F4.3 | ☐      | Publish the frontmatter convention to the standards repo as the citable source | `repository-standards`                                  | —       | Script and docs cite a public path; no `~/knowledge-hub` path in either  |
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
