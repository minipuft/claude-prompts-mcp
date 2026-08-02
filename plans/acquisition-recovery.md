# Acquisition Recovery Plan — Listings, Metadata, README Content Pass

**Status**: Deferred tiers — awaiting MIT observation window (Track A7, `readme-restructure.md`) and further discussion
**Owner**: minipuft
**Created**: 2026-08-02
**Parent**: `plans/readme-restructure.md` (Track A/B); this plan owns what comes _after_ the observation window

## Context

The 2026 download decline began in February — **before** the AGPL relicense (Mar 11) — and the May 15 README rework produced no measurable change through July. Diagnosis: the bottleneck is **acquisition, not conversion**. People who never land on the page can't be converted by a better page. The January peak (996 npm downloads) pattern-matches a discovery event (listing/aggregator pickup), which is repeatable; README quality is the multiplier applied after arrival.

Baseline referrer data (14 days ending 2026-07-31): Google is the **top referrer** (49 views / 28 uniques), then github.com (45/20). Search works; the funnel is just small. Full baseline: `readme-restructure.md` §Adoption Signal.

**Sequencing constraint**: Tiers 1–3 all wait for the MIT observation window to close (~2026-08-14 to 08-28). Changing metadata or the README mid-window re-confounds the license signal — the exact mistake this plan family exists to avoid. Tier 2 (listings audit, read-only portion) is the exception: _checking_ what aggregators show doesn't change anything they index.

---

## Tier 1 — Repo Metadata Search Fix (DEFERRED — rework approach in discussion first)

The metadata surfaces search engines and GitHub's own search actually weight — currently stale or empty:

| Surface          | Current state                                                                   | Problem                                                                                          |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Repo description | "MCP prompt template server: hot-reload, thinking frameworks, quality gates"    | Pre-rework positioning; doesn't match README's three-beat tagline (craft / orchestrate / export) |
| Homepage URL     | _(empty)_                                                                       | Dead SEO surface; nothing to point to yet (docs site? npm page? charter question)                |
| Topics           | 13 topics; missing `claude-code`, `agentic-workflows`, `subagents`, `ai-agents` | Topic pages are a GitHub-internal discovery channel                                              |
| npm `keywords`   | _(audit `server/package.json` during execution)_                                | npm search ranks on keywords + downloads                                                         |

**Open questions to settle before execution** (why this tier is deferred, not just queued):

- Should the description mirror the README tagline verbatim, or be keyword-forward since it serves search, not readers? (Different consumption context — the `directive-contexts` argument applies to metadata too.)
- Homepage URL target: npm package page, `docs/README.md` deep link, or a future GitHub Pages docs site? Empty is worst; picking one is a positioning decision.
- Topic selection: chase high-traffic topics (`ai-agents`) vs precise ones (`mcp-server`)? Verify what topic pages competitors rank on before choosing.
- Repo _name_: `minipuft/claude-prompts` vs npm `claude-prompts` vs the local dir `claude-prompts-mcp`. "mcp" in the repo name is itself a search token. Renaming has redirect costs — discuss, probably reject, but decide explicitly.

**Exit**: description/homepage/topics/keywords updated in one pass, recorded here, dated — so any traffic change in the following weeks is attributable.

---

## Tier 2 — Aggregator Listings Audit + Per-Platform Integration (DEFERRED)

Two sub-phases: **audit** (read-only, may run during the observation window) and **integrate** (after window closes).

### 2a. Audit — what does each platform currently show?

For each platform: are we listed at all · what license is displayed · what description/version is cached · is the listing claimed/owned by us. Record findings in a table appended to this section.

### 2b. Integration paths per platform

Mechanisms below are from general knowledge — **verify each platform's current submission process at execution time** (this ecosystem churns fast; some of these may have merged, died, or changed process since early 2026).

| Platform                                                       | Type                      | Integration mechanism                                                                                                          | Effort | Notes                                                                                                                                                       |
| -------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Official MCP Registry** (`registry.modelcontextprotocol.io`) | Canonical registry        | `server.json` in repo + publish via `mcp-publisher` CLI; npm package validation                                                | Medium | Highest-leverage single listing — downstream aggregators increasingly source from it. Check if we already publish; if not, this is the flagship integration |
| **Glama** (glama.ai)                                           | Directory + inspector     | Auto-indexes GitHub; claim the server, add `glama.json` for metadata control                                                   | Low    | Verify displayed license — auto-indexed listings cache stale data                                                                                           |
| **PulseMCP** (pulsemcp.com)                                    | Directory + newsletter    | Auto-index + manual submission form; newsletter feature is pitchable                                                           | Low    | Newsletter mention is the discovery-event lever, not just the listing                                                                                       |
| **Smithery** (smithery.ai)                                     | Registry + hosted runtime | `smithery.yaml` in repo + registry submission                                                                                  | Medium | Hosted-runtime path may not fit (we're stdio + hooks-centric); listing-only is fine                                                                         |
| **mcp.so**                                                     | Directory                 | Submission via site form / GitHub PR                                                                                           | Low    | Verify AGPL isn't cached                                                                                                                                    |
| **awesome-mcp-servers** (punkpeye + wong2 lists)               | Curated GitHub lists      | PR adding one line under the right category                                                                                    | Low    | High Google juice — these lists rank; check if already present and how described                                                                            |
| **modelcontextprotocol/servers** community list                | Official repo README      | PR to community section                                                                                                        | Low    | Strict formatting; read contribution rules first                                                                                                            |
| **Cursor directory** (cursor.directory/mcp)                    | Client-specific directory | Submission form                                                                                                                | Low    | We support Cursor via one-click deeplink already — listing closes the loop                                                                                  |
| **MCP Market / mcpmarket.com**                                 | Directory                 | Submission form                                                                                                                | Low    | Lower priority; verify it still exists                                                                                                                      |
| **Claude Code plugin ecosystem**                               | Marketplace lists         | Already on `minipuft/minipuft-plugins`; check community marketplace aggregator lists (awesome-claude-code, plugin directories) | Low    | Plugin install is our _recommended_ path — underexposed relative to MCP directories                                                                         |
| **npm**                                                        | Package registry          | Keywords, README rendering on package page                                                                                     | Low    | Overlaps Tier 1; npm README can differ from repo README if repo README is too GitHub-specific                                                               |

**Prioritization heuristic**: official MCP Registry first (upstream of others), then the two awesome-lists (search-ranking pages), then claim/refresh auto-indexed listings (Glama, PulseMCP), then submission-form directories.

**Exit**: audit table filled; every platform either integrated, submitted, or explicitly rejected with a reason; dates recorded so traffic changes are attributable per-listing.

---

## Tier 3 — Server Capability Research Pass → README Content Pass (DEFERRED, conditional)

Acknowledged risk: the README may still under-communicate or mis-communicate what the server actually does. Before any further README rework, do a **capability inventory pass** — the README should be checked against the server, not against our memory of it.

### 3a. Capability research pass

- Inventory what the server _actually provides_ from source of truth (`server/dist/**` behavior, `docs/`, contracts): operators, gate types, verification presets, chain semantics, skills-sync targets, hook behaviors per client, resource_manager surface.
- Diff that inventory against what the README claims/omits. Three failure classes to look for:
  1. **Unclear** — functionality mentioned but a first-time reader can't tell what it does (candidate from Maya round: "less-technical teammates" story, `%judge`).
  2. **Better example exists** — the current example undersells; a bundled prompt or real workflow demonstrates it better.
  3. **Unnotated** — functionality the server has that the README never surfaces (candidates: checkpoints, MCP Resources protocol, style system, argument history, workspace scoping — verify each is real and user-facing before adding).
- Output: a claims-vs-capabilities table appended here; each gap tagged unclear / better-example / unnotated.

### 3b. README content pass (only if 3a finds material gaps)

- Fixes flow through the existing charter + `validate:readme` guardrails; 400-line budget still binds.
- Anything that doesn't fit the budget goes to `docs/` with a pointer — the Tier 3 answer to "more to say" is never "longer README".
- Optional re-validation: fresh Maya-style roleplay agent against the revised README (per `readme-restructure.md` B3.5 follow-up).

**Trigger to activate this tier**: observation window closed, AND (3a finds gaps OR listing integrations drive traffic whose bounce suggests conversion problems).

---

## Sequencing Summary

```
NOW          → A8 baseline recorded (readme-restructure.md §Adoption Signal)
Aug 2–~28    → MIT observation window: no README/metadata changes
             → Tier 2a audit may run (read-only)
Window close → record signal → discuss Tier 1 open questions → execute Tier 1
             → Tier 2b integrations (registry-first order)
             → Tier 3a capability research → 3b README pass if warranted
```

Each executed change gets a date recorded in this file — one variable at a time is the whole lesson of the AGPL episode.
