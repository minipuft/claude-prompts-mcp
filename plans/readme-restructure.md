---
title: "README Restructure & License Migration Plan"
date: 2026-05-13
status: backlog
tags: []
---

# README Restructure & License Migration Plan

**Status**: Draft
**Owner**: minipuft
**Charter**: `docs/portfolio/readme-charter.md`
**Created**: 2026-05-13

## Context

Current `README.md` (688 lines) fails multiple charter principles: pitch buried under install plumbing, primitives defined 3+ times, Diátaxis quadrants unlabelled, doc table duplicates `docs/README.md`. Adoption has stalled since the simultaneous AGPL-3.0 relicense + README rewrite.

Two variables changed at once. The plan separates them to recover causal signal.

## Goals

1. **Restore acquisition signal** — first screen converts curious visitors instead of overwhelming them.
2. **Restore corporate accessibility** — license back to MIT, matching the MCP ecosystem default.
3. **Prevent regression** — guardrails so the next contributor cannot silently violate the charter.

## Non-goals

- Rewriting `docs/` content. The Diátaxis split already exists; the plan respects it.
- Product/feature changes. No code modifications in this plan.
- Re-licensing transitive contributions without verifying authorship.

## Strategy: isolate variables

Track A (license) runs **before** Track B (README), not in parallel:

| Order | Track                                    | Reason                                            |
| ----- | ---------------------------------------- | ------------------------------------------------- |
| 1     | License migration (Track A)              | Binary signal — observable in 2–4 weeks           |
| 2     | Observation window                       | If adoption recovers, README is the smaller lever |
| 3     | README restructure (Track B, Phases 1–4) | Iterate on stable license ground                  |

Running both at once again re-confounds the signal we already lost once.

---

## Track A — License Migration (AGPL-3.0 → MIT)

### A1. Audit dependency licenses

```bash
cd server && npx license-checker --production --summary
```

- Confirm all production deps are MIT / Apache-2.0 / BSD / ISC.
- Any GPL / AGPL / SSPL production dep blocks MIT relicensing.
- **Exit**: zero copyleft production dependencies.

### A2. Audit contributor authorship

```bash
git shortlog -sne
```

- Sole author → skip A3.
- Multiple authors → A3 required.

### A3. Contributor consent (only if A2 shows others)

- Open issue listing every non-trivial contributor.
- Each signs off via PR comment or DCO.
- **Exit**: written consent from every contributor whose code remains.

### A4. Replace LICENSE

- Replace `LICENSE` content with MIT text. Copyright line: `Copyright (c) <year> <owner>`.
- Update `package.json` `"license": "MIT"`.
- Update README license badge.
- Update any `@license` headers in source files.

### A5. Document the change

- `CHANGELOG.md` entry: `Changed: re-licensed from AGPL-3.0 to MIT to match MCP ecosystem default and unblock corporate adoption.`
- Optional: short rationale in `docs/portfolio/design-decisions.md` (where existing decisions live).

### A6. Publish

- Tag release. Push to npm.
- GitHub auto-detects license from `LICENSE` — verify the repo sidebar updates.

### A7. Observe (2–4 weeks)

- Monitor: npm downloads, GitHub stars, issue/PR open rate.
- Do **not** touch the README during this window.
- **Exit**: enough signal to judge whether Track B is high- or low-priority.

### A8. Record signal

- Append observed metrics to the bottom of this file under a `## Adoption Signal` heading.
- This is the empirical grounding for prioritising Track B.

### Note on MIT vs Apache-2.0

MIT was specified. Apache-2.0 remains a one-line alternative — adds an explicit patent grant which matters for AI-adjacent tooling. Migration MIT → Apache-2.0 later is friction-free (both permissive). Sticking with MIT per direction.

---

## Track B — README Restructure (after Track A)

Phases ship in order. **Phase B0 (guardrails) lands first** so every subsequent content phase is measured against the charter at merge time, not retroactively.

### Phase B0 — Guardrails & discovery surfaces

**Goal**: Charter is discoverable, enforceable, and unavoidable. No content phase can ship without it failing or passing.

**Scope**:

_Automated checks_

- `server/scripts/validate-readme.js` (renamed from `scripts/check-readme.sh` per sibling-pattern discovery: 6 `validate-*.js` precedents in `server/scripts/` vs 1 process-bash; npm target uses `validate:*` namespace not `check:*`):
  - Fail if `wc -l README.md` > 400.
  - Fail on forbidden words (charter §5) unless preceded by `<!-- charter-allow: <word> -->`.
  - Fail if any `^## ` heading lacks a `<!-- diataxis: tutorial|how-to|reference|explanation -->` marker within the prior 3 lines.
  - Fail on broken internal links (regex-based; HTTP link checker deferred until `markdown-link-check` dep is added).
- Wire into `npm run validate:all` as `validate:readme`. Warn-only on first cycle per bundled-release strategy; flips to `--mode=block` at end of B2 once markers are added.

_Author-facing prompts_

- `.github/PULL_REQUEST_TEMPLATE.md` — add 5-question charter block:
  1. Which charter sections does this change touch?
  2. Did `npm run validate:readme` pass locally?
  3. Do the first 30 lines still contain the pitch table?
  4. Any new `<details>` blocks above the fold? (link to §4 budget rule)
  5. Any new cross-link — what Diátaxis quadrant does it point to?

_Discovery surfaces_ (charter only enforces if found)

- `CONTRIBUTING.md` — add section: "README changes follow `docs/portfolio/readme-charter.md`."
- `CLAUDE.md` (project root) — add one-line pointer so AI assistants follow charter when editing README.
- `README.md` top-of-file HTML comment: `<!-- maintainers: this README is governed by docs/portfolio/readme-charter.md -->`.
- `docs/guides/release-process.md` — add "first-time-reader walkthrough" step to release checklist.

**Exit criteria**:

- `npm run validate:readme` runs in CI and blocks on charter violations.
- PR template references charter; charter file linked from `CONTRIBUTING.md`, `CLAUDE.md`, and top of `README.md`.
- Release checklist includes the walkthrough step.
- ~~One dry-run PR exercises the checks (open + close, don't merge content yet).~~ **Superseded by bundled-release strategy** — calibration smoke-test captured locally (10 expected violations: 1 budget, 1 voice, 8 quadrant); single eventual PR covers calibration + content rework together.

### Phase B1 — Pitch & first-screen recovery

**Goal**: First-time visitor reaches a clear pitch + one runnable command within 30 lines.

**Scope**:

- Promote comparison table (current l. 28–37) to immediately under the tagline.
- Add "Is this for me?" filter — 3 bullets: "Use if…", "Skip if…", "Coming from X? Here's the difference."
- Trim Quick Start to two visible clients (Claude Code, Claude Desktop). Collapse all others into one `<details>Other clients</details>` block.
- Move "Custom Resources" content (l. 274–333) to `docs/guides/custom-resources.md`; leave a one-line pointer in README.

**Exit criteria**:

- Tagline → "What You Get" ≤ 80 lines.
- ≤ 4 `<details>` blocks above the fold.
- Charter §2 audience test passes for "MCP-aware dev" persona.
- `npm run validate:readme` passes on the merged diff.

### Phase B2 — Structure & deduplication

**Goal**: Each primitive defined once; sections labelled by Diátaxis quadrant.

**Scope**:

- Add `<!-- diataxis: ... -->` marker to every section (required by B0's check — failures here surface immediately in CI).
- Collapse gate / methodology / operator definitions — one definition per primitive, one reference table.
- Delete the "Documentation" table at the bottom (l. 649–666) OR re-categorize by Diátaxis quadrant. Recommended: delete; link to `docs/README.md` instead.
- Reduce `> [!TIP]` callouts to ≤ 4 total.

**Exit criteria**:

- Charter §7 test passes (one canonical definition per primitive).
- Charter §6 quadrant marker test passes (CI-enforced).
- `npm run validate:readme` passes.

### Phase B3 — Mental model & differentiator promotion

**Goal**: Reader sees the flow before operator syntax. Hooks surface as the differentiator they are.

**Scope**:

- Move Mermaid diagram above operator examples — or cut it and rely on `docs/architecture/overview.md`.
- Promote "With Hooks" out of `<details>` into a top-level section (if hooks are kept as a differentiator).
- Trim demo GIFs: keep hero + one workflow demo inline; others link out to `assets/`.
- Add minimal social proof (npm downloads, release date, contributor count) — only if numbers exist and don't signal "pre-launch".

**Exit criteria**:

- Charter §3 reader-journey test passes (manual walkthrough recorded in this plan).
- Total README ≤ 400 lines (CI-enforced).
- `npm run validate:readme` passes.

---

## Risks & Mitigations

| Risk                                                                  | Likelihood          | Mitigation                                                                                            |
| --------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| Track A reveals AGPL was not the cause; adoption stays flat           | Medium              | Track B was queued anyway — begin sooner                                                              |
| Contributor consent (A3) blocks relicensing                           | Low (small project) | Replace blocked code, or stage MIT for new commits via explicit relicense commit                      |
| README budget too tight; valuable content gets cut                    | Medium              | Move cut content to dedicated `docs/`, not delete                                                     |
| Forbidden-word check false positives                                  | Low                 | Allowlist comment: `<!-- charter-allow: powerful -->`                                                 |
| B0 ships before charter content is fully accurate; CI generates noise | Medium              | Allowlist pattern handles edge cases; B0 includes one dry-run PR to surface false positives before B1 |
| Charter pointer in CLAUDE.md or CONTRIBUTING goes stale               | Low                 | Quarterly charter review (§9) verifies discovery surfaces still resolve                               |
| Charter becomes new place for drift                                   | Medium              | Amendment process in charter §10; quarterly review                                                    |

## Rollback

- **License** — revertible via single commit + patch npm publish. No code changes.
- **README rework (B0 + B1–B3 bundled)** — single commit ships everything. Revert is one `git revert`; charter file remains as docs even after revert. If guardrails generate noise, the warn-mode default in `validate:all` keeps CI green; flip-to-block is opt-in at end of B2.

## Tracking

- Phase progress ticked off in this file as PRs merge.
- Charter violations logged as issues with label `readme-charter`.
- Adoption signal (Track A.8) recorded in a `## Adoption Signal` section below once observed.

## Open Questions

- Should the "Coming from X? Here's the difference" bullet target raw MCP prompts, Claude Code skills directly, or both?
- Should social-proof badges be conditional on a minimum threshold (e.g., ≥ 50 stars) to avoid signalling "small project"?
- Charter home: `docs/portfolio/readme-charter.md` (current) or repo-root `README-CHARTER.md` for visibility?
- Should `validate:all` block CI on charter violations, or only warn until the charter has been stable for one release cycle?

---

## Phase B3.5 — UX-test refinements (2026-05-17)

Triggered by a roleplay UX test of the post-B3 README using a `general-purpose` Agent configured as **Maya Okafor** — skeptical senior dev, 5-minute window, evaluating MCP servers. She made it to the bottom and chose "Deeper eval" (forward-leaning), but flagged 5 friction points. All addressed in one wave on `relicense/readme-rework`.

| #   | Maya finding                                  | Fix shipped                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Chain example buried behind reference content | New `### Five seconds of syntax` block hoisted between "Is this for me?" filter and hero GIF — 3-line annotated chain + one paragraph                                                                                                                        |
| 2   | "What You Get" repeats top pitch table        | Compressed 50 lines (4 subsections) → 12-line 4-row reference card (Primitive · Symbol · What it is · Example)                                                                                                                                               |
| 3   | No explicit "vs. rolling your own" framing    | Added 5th bullet to "Is this for me?" naming markdown-prompts-in-a-repo decay path                                                                                                                                                                           |
| 4   | TIP callouts read as SEO-padding              | Stripped all 4 remaining TIPs; folded links into prose. Net: 9 → 0 across B2 + B3.5. Plus fixed the duplicate `---` typo at the old TIP location                                                                                                             |
| 5   | `@CAGEERF` lands as invented jargon           | Methodology section pivots to integration-first framing inside the reference card; `@ReACT` (paper-citable) replaces `@CAGEERF` in the headline chain example and the "What happened" annotation; CAGEERF remains discoverable as one of the bundled options |

### Metrics

| Metric                                                | Pre-B3.5           | Post-B3.5                                  |
| ----------------------------------------------------- | ------------------ | ------------------------------------------ |
| Line count                                            | 404                | **375**                                    |
| `> [!TIP]` callouts                                   | 4                  | **0**                                      |
| Forbidden-word violations                             | 0                  | 0 (one self-induced during editing, fixed) |
| `validate:readme --mode=block`                        | pass               | **pass**                                   |
| Maya's question (d) "different from rolling our own?" | PARTIAL (inferred) | YES (explicit bullet)                      |

### Deferred

- Tagline → `## What You Get` ≤ 80 lines (charter §4 strict target). Current ≈ 110 lines. Quick Start install commands still occupy the gap; further trim sacrifices install utility.
- Maya's question (b) "less-technical teammates can use it?" — still PARTIAL. The `skills:export` consumer story isn't called out loudly enough. Out of B3.5 scope; revisit if adoption signal in A7 shows operator-syntax friction.

### Recommended follow-up (optional)

Spawn a fresh Maya agent against the post-B3.5 README, compare verdict against the original roleplay transcript. If Maya now reaches "Install" instead of "Deeper eval", the iteration is empirically validated.

---

## Adoption Signal (Track A8)

**Baseline recorded 2026-08-02** — two days after MIT restore (2026-07-31). Observation window: ~2026-08-14 to 08-28. No README/metadata changes until it closes. Follow-up work: `plans/acquisition-recovery.md`.

**Window paused 2026-08-02**: capability research (`acquisition-recovery.md` §3a) found 9 factually wrong README claims (a documented modifier that throws, a claimed-but-unimplemented feature). Owner approved a defect carve-out — accuracy fixes only, no restructuring. **The window restarts from the day the fixes ship**; recompute the close date from that commit's date. Baseline metrics above remain valid (metadata/listings unchanged).

**Timeline correction**: Track A/B order inverted in practice — README rework shipped ~2026-05-15 under AGPL; MIT restored 2026-07-31. Variables still isolated, opposite order: May 15–Jul 31 = new README + AGPL · Aug 1+ = new README + MIT.

### npm monthly downloads (`claude-prompts`)

| Month   | Downloads | Event                                                      |
| ------- | --------- | ---------------------------------------------------------- |
| 2025-12 | 401       |                                                            |
| 2026-01 | 996       | peak — likely discovery event                              |
| 2026-02 | 297       | decline starts (pre-AGPL)                                  |
| 2026-03 | 670       | AGPL lands Mar 11                                          |
| 2026-04 | 134       |                                                            |
| 2026-05 | 171       | README rework lands May 15 — no measurable change          |
| 2026-06 | 171       |                                                            |
| 2026-07 | 148       | MIT restored Jul 31                                        |
| 2026-08 | 341       | **Aug 1 alone** — watch whether post-MIT signal or one-off |

**Reading**: decline began before AGPL; AGPL plausibly suppressed recovery rather than caused the drop. New README moved nothing May–Jul → bottleneck is acquisition, not conversion.

### GitHub (2026-08-02 snapshot)

- **Stars**: 182
- **Views** (14d ending Jul 31): 175 total / 78 unique
- **Clones** (14d): 21,917 total / 205 unique — daily 1,100–1,900 with ~25 uniques ⇒ dominated by CI/bots; track _uniques_ only
- **Top referrers** (14d): Google 49/28 · github.com 45/20 · Bing 5/1 · Brave 2/2 · DuckDuckGo 1/1 · context7.com 1/1 — **Google is already the top channel**; search works, funnel is small
- **Top content paths**: Overview 78/45 · `docs/architecture/overview.md` 20/11 · `docs/tutorials/build-first-prompt.md` 12/11

**Traffic API retains only 14 days** — re-snapshot views/clones/referrers at least fortnightly during the window (next: ~2026-08-14).

### Window-close checklist

- [ ] Re-snapshot npm monthlies + GitHub traffic (~Aug 14 and ~Aug 28)
- [ ] Judge: did MIT restore move downloads/stars/uniques?
- [ ] Record verdict here; then unblock `acquisition-recovery.md` Tiers 1–3
