---
title: "Acquisition Recovery Plan — Listings, Metadata, README Content Pass"
date: 2026-08-02
status: active
tags: []
---

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

**Decisions (settled 2026-08-02; execution still waits for window close)**:

- **Description: keyword-forward, but a truthful sentence — not a keyword pile.** Metadata serves *retrieval*, not settled readers: it's scanned in Google SERPs, GitHub search results, and aggregator lists next to competitors. The un-salesy voice rule (charter §5) governs prose someone reads; metadata is indexing language, a different consumption context. Front-load the tokens people search, keep the charter's contrast/measured-claim discipline. Draft (refine against Tier 3a inventory before shipping):
  > `MCP server for reusable prompt templates, multi-step chains, and quality gates — compose agentic workflows with an operator syntax; export as native skills to Claude Code, Cursor, OpenCode, and more.`
- **Homepage URL → `docs/README.md` deep link** (`https://github.com/minipuft/claude-prompts/tree/main/docs`). Reasoning: no standalone site exists; npm page is circular (it points back to GitHub and duplicates the README); traffic data shows visitors already click into `docs/architecture` and tutorials, so the About-sidebar link feeds a demonstrated appetite. SEO weight of the homepage field is minor either way — its value is the human click affordance. A GitHub Pages docs site is the real long-term SEO surface; revisit only if Tier 2 listings prove traffic worth investing in.
- **Topics: add precise + adjacent, skip pure-volume chasing.** Add `mcp-server`, `claude-code`, `agentic-workflows`, `ai-agents`, `subagents` (verify 20-topic cap). Precise topics (`mcp-server`) put us on pages where searchers have intent; high-traffic generic topics rank us behind thousand-star repos where we're invisible anyway.
- **Repo rename: REOPENED, gated on rebranding (2026-08-02).** The initial rejection was revised on evidence: name-token matching demonstrably wins our target queries (`mcp-prompt-server` 246★ ranks #1; `mcp-prompt-templates` ranks with only 24★ — pure name match), GitHub redirects make a rename cheap for all external links, and the uniquely right moment is **before Tier 2 listings** (every listing pins the URL that exists at submission). Blast radius measured: ~15 self-owned files in this repo + README mentions in minipuft-plugins/gemini-prompts/opencode-prompts; no plugin manifests, no install paths; npm name unaffected (can't rename, stays `claude-prompts`). **Owner decision: settle the rebranding first** — see §Rebranding below. Rename executes (or is re-rejected) as part of that decision.

### Rebranding (open — decide before rename, blocks Tier 2 listings)

Owner is considering a rebrand around a **synthesis** identity: a mascot/guide (Moogle-inspired, FF-synthesis flavor) that crafts a finished item from parts — **resources (prompts/gates/frameworks/styles) are the ingredients, the operator syntax is the recipe, the workflow is the crafted item**. Earlier framing candidate: "skill synthesizer"; counter-consideration: staying workflow-focused.

Decision inputs recorded 2026-08-02:

- **The synthesis metaphor is a strong narrative layer regardless of naming** — it maps 1:1 onto the existing three-beat structure (craft/orchestrate/export) and gives the README/docs a coherent story. It can ship in README/logo/docs *without* any rename.
- **A pure brand name sacrifices measured search equity.** Name-token match is what ranks 24★ repos above us; a whimsical name (`moogle-*`, invented word) has zero query tokens and needs marketing muscle to compensate. If renaming, the pattern that keeps both: `<brand>-mcp` or keep a descriptor token (`*-prompts-mcp`, `*-synth-mcp`).
- **The `claude` token cuts both ways.** Helps: `claude-code` topic space, Claude-first user recognition, npm package continuity (`claude-prompts` is permanent). Hurts: pulls GitHub search toward the wrong-intent prompt-collection space; understates multi-client support (Cursor/OpenCode/Gemini). If the rebrand lands, dropping `claude` from the *repo name* is defensible **because the npm name keeps it** — brand continuity is preserved at the package layer either way.
- **Sequencing**: rebrand decision → rename (or re-reject) → Tier 2 listings. Metadata already shipped (below) is rebrand-neutral: description/topics/keywords say "MCP server for prompt templates/workflows", true under any name.

**npm package relaunch: REJECTED 2026-08-02** (rebrand affects repo name + narrative only; the npm package stays `claude-prompts` permanently). The deciding asymmetry: GitHub renames redirect forever; npm has no redirects at all — a new package name means starting at zero downloads (abandoning the only ranking signal npm respects), splitting installed users off the update path, and breaking every config/marketplace manifest that says `npx claude-prompts`. And since the underlying services haven't materially changed, a relaunch would signal "new product" without substance — exactly the marketing-over-evidence move the charter voice forbids. A relaunch becomes defensible only bundled with a genuine major-capability release, and even then as new-package + `npm deprecate` pointer on the old one.

**Name candidate screening (2026-08-02, first pass)**:

| Candidate | npm | GitHub collision | Read |
| --------- | --- | ---------------- | ---- |
| `promptwright` | free | 113★ desktop agent + dataset-gen tool share it | -wright = craftsman (playwright, wheelwright) — fits synthesis exactly, keeps `prompt` token; moderate collision |
| `mogsmith` | free | essentially none — uniquely googleable | catchy, craft-flavored, zero collisions; "mog" is Moogle-adjacent — coined word likely fine, but the **mascot itself must be original, not a Moogle (Square Enix IP)** |
| `prompt-forge` | free | 776★ prompt-engineering workbench | direct-space collision — skip |
| `crucible` | — | Atlassian Crucible (dev tool) + 774★ Galois lib | crowded — skip |
| `promptsmith`, `synthkit`, `chainwright`, `atelier-mcp` | taken | — | out |

**Round 2 — phonetics-first (2026-08-02)**: owner verdict on round 1 was "promptwright best, but still confusing"; the reference points named (kobble, moogle, kupo) share a recipe — plosive /k/ onset + rounded back vowel + trochaic bounce + -le/-o diminutive with doubled middle consonant. Generated ~20 to that recipe; survivors after npm + GitHub screen: **kubble** (KUB-ble, cauldron-bubble hook, clean), **kluppo** (KLUP-po, kupo cadence, zero hits anywhere), **klobbo** (KLOB-bo, onomatopoeic assembly-thunk, zero hits), **snibble** (SNIB-ble, snib = small latch → gates-as-latches, near-clean). Casualties: kippo (1.7k★ SSH honeypot), boffin (37★ AI coding-agent tool — direct-space), kitbash/gubbins/doddle/mise/sous/roux (npm taken). Recognition-test artifact updated (round 2 cards + promptwright/loomling carried).

**Round 3 — hybrids (2026-08-02)**: owner liked all round-2 coinages; asked for two-root hybrids where each half carries meaning and the fusion states the theme (`[craft root] × [creature/parts root]`). 20 generated, 15 npm-available. Fully clean (zero GitHub hits + npm free): **fuseling** (fusion = synthesis + -ling creature — the thesis name), **wispforge**, **tinkerloom**; near-clean: **kitling** (double meaning: kit of parts / baby animal). Notable kills: gatesmith/threadsmith/brewkit/bindle (npm taken), cogsmith + warpling + kilnkit (GitHub handle/org squatted), loomforge + runeloom (tiny but direct-space workflow/AI collisions). Artifact updated with rounds 2+3.

**Round 4 — outside-in (2026-08-02)**: owner critique of rounds 1-3 — "we're building words from the foundation (morphemes) inward; fuseling feels accidental. Go outside-in: start from the theme/purpose and the *uses*." Method: name the objects that already exist in the scenes of using the server (slotting abilities, bringing parts to the synthesis shop, chaining combos, composing loadouts). Real evocative world-words are almost all npm-taken (athanor, azoth, assay, materia, loadout, hotbar, spellbook, quickslot, macro-family, hallmark, artificer, atelier). Survivors: **synthshop** (near-clean, npm free — names the literal FF synthesis-shop scene the mascot vision came from; "synth" also winks at modular-synth patching), **theorycraft** (npm free — the real gamer word for designing builds; trading-org squatters on GitHub), **mainhand** (near-clean — the always-equipped slot; litmus-test wrinkle: we're arguably the off-hand), macrobar/combolab/theoryforge (available, weaker). Artifact updated with round 4 cards.

**DIRECTION CHOSEN (2026-08-02): theorycraft** — as identity/narrative. Design the build (workflow) from parts (resources), sim it (gates/verification), take it into the run (export/execute). Primitive nomenclature does NOT change; npm stays `claude-prompts`. Owner confirmed the shopkeeper mascot survives the shift (League-shopkeeper precedent: a shop critter serving a practice, not a place).

**Deep-check result (2026-08-02): the NAME "theorycraft" is BLOCKED; the identity survives.**

- **USPTO serial 99386898 "THEORYCRAFT LABS" (TheorycraftLLC)** — recent application covering SaaS featuring **AI for software development, knowledge management, and workflow automation**. That is this project's exact category; a pending application still establishes priority. Direct class collision.
- **Theorycraft Games Inc** — VC-backed studio (Supervive, 2M+ players; ex-Riot/Blizzard/Bungie founders; theorycraftgames.com, @theorycraft_inc). Owns nearly all "theorycraft" search oxygen — we could never rank on our own brand query.
- **theorycraft-trading.ai** — a third company using TheoryCraft for an AI trading platform.
- GitHub user `theorycraft` taken (2019). npm `theorycraft`/`theorycraft-mcp` free, but irrelevant given the above.

**Resolution path**: use "theorycraft" **descriptively** in copy (community vocabulary — "theorycraft your workflows" as a verb is normal usage, not a mark) while the brand name comes from the adjacent ownable space. First probe, all npm-free: `theoryshop`, `theorybench`, `craftsim`, `buildsim`, `simforge`, `craftlab`, `simshop`. GitHub screen pending. Alternative: revert to **synthshop** (clean, round 4) as the name, with theorycrafting as the README's practice-language — shop + practice + shopkeeper mascot compose coherently.

**Round 5 — the shop idea, worldwide (2026-08-02)**: owner asked for a middle ground — the *idea* of the shopfront/workbench without the literal English word; non-English roots welcome if they meet the phonetic recipe. Mined craft-shop vocabulary across Japanese/Scots/Portuguese/Esperanto. **Front-runner: `kobbo`** (工房 kōbō = artisan's workshop, respelled into the kobble/klobbo sound family — npm free, GitHub essentially clean at 2★ scraps; repo `kobbo-mcp`; shopkeeper-critter mascot fits natively; theorycraft stays as the practice language in copy). Runner-up: `zakka` (雑貨 — shop of useful little things; near-clean). Also clean: `smiddy` (Scots smithy; 1★ spec-dev-engine adjacent), `boteko` (PT). Kills: `yatai` (841★ BentoML), `koubou` (191★ craft tool), `konbini`/`karakuri`/`kojo` (npm taken), `kappo` (launcher). Artifact updated with round 5 cards.

**Round 6 — soft recipe (2026-08-02)**: owner refined the formula — hard /k/ not required; the essentials are **doubled consonant + trochaic bounce + soft feeling across the whole word** (moogle's side of the family, not kobble's). Soft-onset generation across coined words and soft craft vocabulary (loom parts, joinery, finishing). Survivors: **moffle** (MOF-fle — mofu = Japanese "fluffy"; near-clean, 7★ IRC archive), **niddy** (NID-dy — from the niddy-noddy, the real yarn-winder that turns loose yarn into ordered skeins; near-clean), **sibble** (SIB-ble — sibling warmth, litmus-test-as-a-feeling; npm free), plus available-but-quieter momme/gusset/wamble/mobbo. Kills: treadle (157★ Chisel engine + a 3★ workflow engine), ferrule (613★ parser), nubble (99★ app tutorial), bobbin/heddle/fettle/rabbet (npm taken). Artifact updated with round 6 cards.

**Round 7 — the mo·flow fusion (2026-08-02)**: owner direction "moflow/mofflow or down that path" — soft mo syllable × "flow" (the product word itself). Screen: `moflow` DEAD (npm taken + Cisco Talos 305★ + moflow org). **`mofflow`** npm-free, best word of the family (doubled f + literal "flow"), but exact-name collision with MOFFlow — 27★+18★ ML research repos (flow matching for metal-organic frameworks; arXiv presence means Google contention). **`mofuflow`** npm-free + ZERO GitHub hits (mofu = fluffy, explicit; 3 soft syllables). **`mofflo`** npm-free, no exact-name repos (same bounce, kupo-family -o ending, dodges the namespace). Also free: mooflow, womflow, mofu-flow. Artifact updated with round 7 cards.

**Round 8 — palindromes (2026-08-02)**: owner wants symmetry as built-in purpose. True palindromes screened, all npm-free: **flowolf** (f·l·o·w·o·l·f — "flow" forward, "wolf" mirrored; the symmetry maps to run-forward/verify-backward i.e. gates; caveat: active personal GitHub handle `flowolf`, 33★ repos, no project by that name), **woffow** (w·o·f·f·o·w — contains "woof", puppy mascot in the letters; no exact-name repos; soft recipe compliant), **moffom** (m·o·f·f·o·m — round-7 mof- sound made symmetric; near-clean). Also npm-free: mollom, ommo (53★ + hardware co — risky), muffum, mofom, loffol, mofumofu (69★ blog platform — dead), wolflow (wolflow-ai org, AI dev toolkit — dead). Artifact updated with round 8 cards. **Standing front-runners across all rounds: mofflow · mofflo · flowolf · woffow.**

**Round 9 — visual symmetry (2026-08-02)**: owner extended palindromes to *visual* symmetry — mirror-pair letters (b↔d, p↔q; self-mirror o v w x i l u) and rotational ambigram pairs (m↔w, b↔q, d↔p, u↔n; self-rotating o x s z l i). **Front-runner: `mollow`** (m·o·l·l·o·w — a true rotational ambigram, reads identically flipped 180°; sounds like mellow × flow; soft recipe perfect: m onset, doubled ll, trochee; npm free, GitHub essentially clean at 0★ scraps; logo can be a wordmark that survives inversion). Runner-up: `wovow` (mirror-symmetric; contains "wove" = chains and "vow" = gates; near-clean). Kills: dollop/wollow/pooq (npm taken), moom (Moom is Many Tricks' Mac window manager — trademark), mollom (Acquia spam-service history). Owner also accepted `flowolf` despite the personal-handle caveat — **standing finalists: mollow · flowolf · mofflow · mofflo · woffow**.

**Naming funnel** (for the next pass): (1) generate wide using the morphological toolkit — agentive suffixes (-smith/-wright/-ery), Latin/Greek roots (syn-, -texere), portmanteaus, real-word repurpose; (2) mechanical screen: npm 404 + GitHub name search + trademark sanity + google-uniqueness; (3) **recognition test** — present survivors as README-header mockups (name + tagline + mascot sketch in place), not a bare list, because "good name" is an unknown-known: recognized on sight, not stateable in advance; (4) whichever wins, repo becomes `<name>-mcp` or keeps a `prompt` token so the measured name-token search equity survives.

### Tier 1 EXECUTED 2026-08-02 (rebrand-neutral surfaces; rename excluded)

Shipped while the window is paused, bundled with the README defect fixes into one dated event:

- GitHub description → keyword-forward draft (as above, with "workflow chains" + all four client names). ✓
- GitHub homepage → `/tree/main/docs`. ✓
- GitHub topics += `mcp-server`, `agentic-workflows`, `claude-code` (now 16/20). ✓
- npm `keywords` 7→14 (added `mcp-server, prompt-templates, prompt-management, prompt-engineering, claude-code, workflow, chains, quality-gates, skills`; dropped `language-model, server`); npm `description` replaced ("Claude Custom Prompts MCP Server" → same keyword-forward sentence). Takes effect on next npm publish. *(uncommitted until finalize)*
- **Scorecard re-run due ~2026-08-16** (baseline: GitHub #5/#3/absent; npm >20 everywhere).

### Keyword strategy (evidence-based, measured 2026-08-02)

**Method**: rank ourselves in GitHub/npm search for candidate queries; size the topic pages; see what winners use. Findings:

| Query (GitHub search) | Our rank | Verdict |
| --------------------- | -------- | ------- |
| `mcp prompt server` | **#5** | Winnable — push toward #1-3 |
| `prompt templates mcp` | **#3** | Winnable — already near top |
| `mcp workflow` | absent | **Unwinnable** — owned by 4k–46k★ apps (activepieces, n8n-mcp, mcp-agent); don't optimize for it |
| `claude prompts` | absent | **Wrong intent** — that query space is prompt *collections* and system-prompt leaks (5k–166k★). Our repo name pulls us toward a space we can't win and whose searchers want something else |

| Topic | Repos on page | Read |
| ----- | ------------- | ---- |
| `prompt-templates` | 113 | Tiny — 182★ ranks near top. Already tagged ✓ |
| `prompt-management` | 272 | Tiny — near top. Already tagged ✓ |
| `agentic-workflows` | 1,206 | Mid — visible. **Add** |
| `mcp-server` | 22,520 | Large but high-intent. **Add** |
| `claude-code` | 54,786 | Huge — buried, but costs nothing. **Add** |
| `ai-agents` | 63,573 | Huge — invisible at 182★. Skip |

**Strategy**: own the small high-intent spaces (`prompt-templates`, `prompt-management`, "mcp prompt server" queries); be present in mid spaces; don't chase volume topics where 182★ is invisible. The winnable identity is "**MCP server** for prompt templates/workflows" — which confirms the description draft leading with "MCP server", not "Claude".

**npm** (`registry.npmjs.org/-/v1/search`): absent from top 8 for `mcp prompts`, `mcp workflow`, `prompt management`, `mcp server prompts`. npm's score is popularity-dominated, so keywords only fix *matching*, not rank — realistic target is top-10 for `mcp prompts` only. Current `server/package.json` keywords (7, generic): `claude, ai, mcp, model-context-protocol, prompts, language-model, server`. **Add**: `mcp-server`, `prompt-templates`, `prompt-management`, `workflow`, `chains`, `claude-code`, `agents`. Drop `language-model` (nobody searches it).

### Scorecard (repeatable, re-run after Tier 1 ships)

No single "SEO score" exists for a repo, but this fixed query set is scriptable and diffable:

```bash
# GitHub rank (fixed queries)
for q in "mcp+prompt+server" "prompt+templates+mcp" "mcp+prompt+management"; do
  gh api "search/repositories?q=$q&per_page=20" --jq '[.items[].full_name] | index("minipuft/claude-prompts")'
done
# npm rank
curl -s "https://registry.npmjs.org/-/v1/search?text=mcp%20prompts&size=20" | jq '[.objects[].package.name] | index("claude-prompts")'
```

**Baseline 2026-08-02**: GitHub `mcp prompt server` #5 · `prompt templates mcp` #3 · npm all queries >20. Lagging outcome metric stays the A8 referrer uniques (Google 28/14d). Google itself is unscoreable without Search Console, which needs an ownable site — one more argument for an eventual GitHub Pages docs site, not for now.

**Exit**: description/homepage/topics/keywords updated in one pass after window close, recorded here, dated — so any traffic change in the following weeks is attributable. Re-run scorecard ~2 weeks after shipping.

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

## Tier 3 — Server Capability Research Pass → README Content Pass (3a ACTIVE NOW; 3b deferred, conditional)

Acknowledged risk: the README may still under-communicate or mis-communicate what the server actually does. Before any further README rework, do a **capability inventory pass** — the README should be checked against the server, not against our memory of it.

**Reordering (2026-08-02)**: 3a is read-only and window-safe, so it runs **now**, during the observation window. Its output also feeds Tier 1 (keyword selection grounded in real capabilities) and Tier 2 (listing descriptions) — doing it first makes every downstream tier more accurate. 3b (README edits) remains gated on window close.

### 3a. Capability research pass

- Inventory what the server _actually provides_ from source of truth (`server/dist/**` behavior, `docs/`, contracts): operators, gate types, verification presets, chain semantics, skills-sync targets, hook behaviors per client, resource_manager surface.
- Diff that inventory against what the README claims/omits. Three failure classes to look for:
  1. **Unclear** — functionality mentioned but a first-time reader can't tell what it does (candidate from Maya round: "less-technical teammates" story, `%judge`).
  2. **Better example exists** — the current example undersells; a bundled prompt or real workflow demonstrates it better.
  3. **Unnotated** — functionality the server has that the README never surfaces (candidates: checkpoints, MCP Resources protocol, style system, argument history, workspace scoping — verify each is real and user-facing before adding).
- Output: a claims-vs-capabilities table appended here; each gap tagged unclear / better-example / unnotated.

### 3a Findings (research completed 2026-08-02)

Full-repo sweep (docs, contracts, source, hooks, bundled resources) vs README. **Verdict: 3b is warranted — the README contains 9 overstated claims, several of which a first-time user hits directly.**

#### OVERSTATED — README claims the server cannot back (defect class; candidates for immediate fix, see decision below)

| Claim | Reality | Evidence |
| ----- | ------- | -------- |
| `%guided — Force framework injection` (Syntax Reference) | Parser throws `ValidationError` on `%guided`; the real fourth modifier is `%framework` | `server/src/engine/execution/parsers/command-parser.ts` L38-43, L126 |
| "Chains also support conditional branching" | `?` operator is `"status": "reserved"` — unimplemented; no condition field in chain schema | `tooling/contracts/registries/operators.json`, `docs/reference/chain-schema.md` |
| `#concise` style example | Shipped styles: `analytical, creative, procedural, reasoning` — no `concise` | `server/resources/styles/` |
| `--init` "scaffolds prompts, gates, frameworks, and styles" | Creates 3 starter prompts + `config.json` only | `server/src/cli-shared/workspace-init.ts` L73-99 |
| "90+ prompts across 11 categories" | 122 prompt.yaml across 17 category dirs | `server/resources/prompts/` |
| `%judge` "applies the best combination automatically" | Contract marks `%judge (preview)` — shows a guidance menu, doesn't execute | `tooling/contracts/prompt-engine.json`, `docs/reference/mcp-tools.md` L280 |
| resource_manager "export resources" | No `export` action exists; export lives in skills-sync | `tooling/contracts/resource-manager.json` |
| One-modifier-per-command unstated | Stacking `%lean %judge` is a hard parse error | `command-parser.ts` L136-140 |
| (docs, not README) `system_control action:"whoami"` | Not routed — identity-scope guide tells users to verify with an action that doesn't exist | `system-control-router.ts` L354-372 |

#### UNNOTATED — highest-value capabilities the README never surfaces (feeds 3b prioritization + Tier 1 keywords + Tier 2 listing copy)

- **Shell gate response injection** (`shell_stdin_source: agent_response` + shipped `path-verification` gate + `verify-path-claims.mjs`) — verifies agent *claims* against the filesystem; the strongest anti-hallucination story in the repo. Meanwhile the README leads with `:: 'cite sources'`, a self-reported check a fabricated PASS slips through. **The README trades its best evidence for its weakest claim.**
- **`cpm` CLI** — 17 commands, server-free validate/create/history/rollback/config; a whole second product surface, never named.
- **MCP Resources protocol** — `resource://` URIs for prompts/gates/frameworks/sessions/metrics/logs, 4-30x token savings, `list_changed` notifications.
- **Gate enforcement is uneven** — `inline_guidance`/`framework_compliance` are display-only, `llm_self_check` has no runner; only `shell_verify`/`script_tool` are hard-enforced. README implies all `::` gates are enforced equally.
- **Built-in commands** (`>>listprompts`, `>>help`, `>>status`, `>>gates <search>`) — the first thing a new user needs, undocumented.
- **Phase guards** (deterministic `required`/`contains_any`/`forbidden_terms` checks, zero LLM cost) · **script tools in prompts** (python/node/shell with auto-trigger) · **Nunjucks templating** (`{{ref:}}`, `{{script:}}`, conditionals) · **session lifecycle** (`list/inspect/cancel/clear` — "how do I kill a stuck chain?") · **checkpoints** (git-stash safety net) · **per-project framework pinning / workspace isolation** · **`subagentModel: heavy|standard|fast`** cost tiering for `==>` · **skills-sync `pull`/`clone`** (round-trip edits, import external SKILL.md) + auto-deregistration (solves the duplication objection) · **OpenTelemetry** per-stage spans · **23 bundled gates** (docs list 8) · **2 undocumented frameworks** (`radiant`, `verify`).

#### BETTER-EXAMPLE-EXISTS

- README's skills-sync example exports `review`/`validate_work` — **the maintainers' own config backed that out** (deregistered 2026-07-12; `/review` collides with a Claude Code built-in). Live config exports `dev_workflow` + `reference_demo`.
- Gate example should be `tech_evaluation_chain` (already in Quick Start!) — demonstrates blocking-vs-advisory, `apply_to_steps`, severity, real `pass_criteria`.
- `docs/guides/chain-authoring-example.md` (real 4-phase pipeline with actual verdicts) beats the 3-line synthetic snippet.

#### UNCLEAR

- README "Judge Mode" (`%judge` resource selection) links to `judge-mode.md`, which documents a *different feature* (context-isolated gate evaluator) sharing the name.
- "blocking or advisory" — three modes exist (+ `informational`); README never says how to choose or what advisory does on FAIL.
- `loop:true` "spawns a fresh context" — undersells a real `claude --print` spawn with budget cap, session story, and cost telemetry (`hooks/ralph-stop.py`).
- `:: verify` in chains applies to first execution only, not re-parsed on resume — a footgun in the README's own headline example, unflagged.

#### Decision needed: defect carve-out vs window purity

The observation window (A7) forbids README changes to keep the MIT signal clean. But the OVERSTATED class is **factual defects** — `%guided` throws an error for anyone who types it *during the window*, costing exactly the evaluators the window is trying to measure. Options:

1. **Strict**: hold everything to window close (~Aug 14-28). Zero confound; broken claims stand for 2-4 weeks.
2. **Defect carve-out (recommended)**: fix only the OVERSTATED table now — small diffs, no restructuring, no new sections. Accuracy fixes don't plausibly move *acquisition* metrics (search/listings don't read README prose), so the confound risk is near zero while the trust cost of broken examples is real. All UNNOTATED/UNCLEAR/BETTER-EXAMPLE work still waits for 3b.

**DECIDED 2026-08-02 (owner)**: defect carve-out executed. Observation window formally **paused** while the fixes land; it **restarts from the day the fixes ship** (new window: ship date + 2-4 weeks). Fixes applied to README.md same day: `%guided`→`%framework` + one-modifier rule, conditional-branching claim removed, `#concise`→`#procedural`, `--init` claim corrected to actual scaffold output, 90+/11→120+/17, `%judge` reworded to recommend-then-confirm, `resource_manager` "export"→"roll back", styles attributed to `cpm` CLI not resource_manager. `validate:readme --mode=block` passes (362 lines). The docs-side `whoami` defect (identity-scope guide references an unrouted action) is out of README scope — fix alongside 3b or as a standalone docs correction.

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
