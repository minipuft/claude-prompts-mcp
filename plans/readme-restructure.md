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
