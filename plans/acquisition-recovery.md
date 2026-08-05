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

## Tier 1 — Repo Metadata Search Fix (EXECUTED 2026-08-02/05 — only the post-ship scorecard re-run remains)

The metadata surfaces search engines and GitHub's own search actually weight — currently stale or empty:

| Surface          | Current state                                                                   | Problem                                                                                          |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Repo description | "MCP prompt template server: hot-reload, thinking frameworks, quality gates"    | Pre-rework positioning; doesn't match README's three-beat tagline (craft / orchestrate / export) |
| Homepage URL     | _(empty)_                                                                       | Dead SEO surface; nothing to point to yet (docs site? npm page? charter question)                |
| Topics           | 13 topics; missing `claude-code`, `agentic-workflows`, `subagents`, `ai-agents` | Topic pages are a GitHub-internal discovery channel                                              |
| npm `keywords`   | _(audit `server/package.json` during execution)_                                | npm search ranks on keywords + downloads                                                         |

**Decisions (settled 2026-08-02; execution still waits for window close)**:

- **Description: keyword-forward, but a truthful sentence — not a keyword pile.** Metadata serves _retrieval_, not settled readers: it's scanned in Google SERPs, GitHub search results, and aggregator lists next to competitors. The un-salesy voice rule (charter §5) governs prose someone reads; metadata is indexing language, a different consumption context. Front-load the tokens people search, keep the charter's contrast/measured-claim discipline. Draft (refine against Tier 3a inventory before shipping):
  > `MCP server for reusable prompt templates, multi-step chains, and quality gates — compose agentic workflows with an operator syntax; export as native skills to Claude Code, Cursor, OpenCode, and more.`
- **Homepage URL → `docs/README.md` deep link** (`https://github.com/minipuft/claude-prompts-mcp/tree/main/docs`). Reasoning: no standalone site exists; npm page is circular (it points back to GitHub and duplicates the README); traffic data shows visitors already click into `docs/architecture` and tutorials, so the About-sidebar link feeds a demonstrated appetite. SEO weight of the homepage field is minor either way — its value is the human click affordance. A GitHub Pages docs site is the real long-term SEO surface; revisit only if Tier 2 listings prove traffic worth investing in.
- **Topics: add precise + adjacent, skip pure-volume chasing.** Add `mcp-server`, `claude-code`, `agentic-workflows`, `ai-agents`, `subagents` (verify 20-topic cap). Precise topics (`mcp-server`) put us on pages where searchers have intent; high-traffic generic topics rank us behind thousand-star repos where we're invisible anyway.
- **Repo rename: REOPENED, gated on rebranding (2026-08-02).** The initial rejection was revised on evidence: name-token matching demonstrably wins our target queries (`mcp-prompt-server` 246★ ranks #1; `mcp-prompt-templates` ranks with only 24★ — pure name match), GitHub redirects make a rename cheap for all external links, and the uniquely right moment is **before Tier 2 listings** (every listing pins the URL that exists at submission). Blast radius measured: ~15 self-owned files in this repo + README mentions in minipuft-plugins/gemini-prompts/opencode-prompts; no plugin manifests, no install paths; npm name unaffected (can't rename, stays `claude-prompts`). **Owner decision: settle the rebranding first** — see §Rebranding below. Rename executes (or is re-rejected) as part of that decision.

### Rebranding (open — decide before rename, blocks Tier 2 listings)

Owner is considering a rebrand around a **synthesis** identity: a mascot/guide (Moogle-inspired, FF-synthesis flavor) that crafts a finished item from parts — **resources (prompts/gates/frameworks/styles) are the ingredients, the operator syntax is the recipe, the workflow is the crafted item**. Earlier framing candidate: "skill synthesizer"; counter-consideration: staying workflow-focused.

Decision inputs recorded 2026-08-02:

- **The synthesis metaphor is a strong narrative layer regardless of naming** — it maps 1:1 onto the existing three-beat structure (craft/orchestrate/export) and gives the README/docs a coherent story. It can ship in README/logo/docs _without_ any rename.
- **A pure brand name sacrifices measured search equity.** Name-token match is what ranks 24★ repos above us; a whimsical name (`moogle-*`, invented word) has zero query tokens and needs marketing muscle to compensate. If renaming, the pattern that keeps both: `<brand>-mcp` or keep a descriptor token (`*-prompts-mcp`, `*-synth-mcp`).
- **The `claude` token cuts both ways.** Helps: `claude-code` topic space, Claude-first user recognition, npm package continuity (`claude-prompts` is permanent). Hurts: pulls GitHub search toward the wrong-intent prompt-collection space; understates multi-client support (Cursor/OpenCode/Gemini). If the rebrand lands, dropping `claude` from the _repo name_ is defensible **because the npm name keeps it** — brand continuity is preserved at the package layer either way.
- **Sequencing**: rebrand decision → rename (or re-reject) → Tier 2 listings. Metadata already shipped (below) is rebrand-neutral: description/topics/keywords say "MCP server for prompt templates/workflows", true under any name.

**npm package relaunch: REJECTED 2026-08-02** (rebrand affects repo name + narrative only; the npm package stays `claude-prompts` permanently). The deciding asymmetry: GitHub renames redirect forever; npm has no redirects at all — a new package name means starting at zero downloads (abandoning the only ranking signal npm respects), splitting installed users off the update path, and breaking every config/marketplace manifest that says `npx claude-prompts`. And since the underlying services haven't materially changed, a relaunch would signal "new product" without substance — exactly the marketing-over-evidence move the charter voice forbids. A relaunch becomes defensible only bundled with a genuine major-capability release, and even then as new-package + `npm deprecate` pointer on the old one.

**Name candidate screening (2026-08-02, first pass)**:

| Candidate                                               | npm   | GitHub collision                                | Read                                                                                                                                                                   |
| ------------------------------------------------------- | ----- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `promptwright`                                          | free  | 113★ desktop agent + dataset-gen tool share it  | -wright = craftsman (playwright, wheelwright) — fits synthesis exactly, keeps `prompt` token; moderate collision                                                       |
| `mogsmith`                                              | free  | essentially none — uniquely googleable          | catchy, craft-flavored, zero collisions; "mog" is Moogle-adjacent — coined word likely fine, but the **mascot itself must be original, not a Moogle (Square Enix IP)** |
| `prompt-forge`                                          | free  | 776★ prompt-engineering workbench               | direct-space collision — skip                                                                                                                                          |
| `crucible`                                              | —     | Atlassian Crucible (dev tool) + 774★ Galois lib | crowded — skip                                                                                                                                                         |
| `promptsmith`, `synthkit`, `chainwright`, `atelier-mcp` | taken | —                                               | out                                                                                                                                                                    |

**Round 2 — phonetics-first (2026-08-02)**: owner verdict on round 1 was "promptwright best, but still confusing"; the reference points named (kobble, moogle, kupo) share a recipe — plosive /k/ onset + rounded back vowel + trochaic bounce + -le/-o diminutive with doubled middle consonant. Generated ~20 to that recipe; survivors after npm + GitHub screen: **kubble** (KUB-ble, cauldron-bubble hook, clean), **kluppo** (KLUP-po, kupo cadence, zero hits anywhere), **klobbo** (KLOB-bo, onomatopoeic assembly-thunk, zero hits), **snibble** (SNIB-ble, snib = small latch → gates-as-latches, near-clean). Casualties: kippo (1.7k★ SSH honeypot), boffin (37★ AI coding-agent tool — direct-space), kitbash/gubbins/doddle/mise/sous/roux (npm taken). Recognition-test artifact updated (round 2 cards + promptwright/loomling carried).

**Round 3 — hybrids (2026-08-02)**: owner liked all round-2 coinages; asked for two-root hybrids where each half carries meaning and the fusion states the theme (`[craft root] × [creature/parts root]`). 20 generated, 15 npm-available. Fully clean (zero GitHub hits + npm free): **fuseling** (fusion = synthesis + -ling creature — the thesis name), **wispforge**, **tinkerloom**; near-clean: **kitling** (double meaning: kit of parts / baby animal). Notable kills: gatesmith/threadsmith/brewkit/bindle (npm taken), cogsmith + warpling + kilnkit (GitHub handle/org squatted), loomforge + runeloom (tiny but direct-space workflow/AI collisions). Artifact updated with rounds 2+3.

**Round 4 — outside-in (2026-08-02)**: owner critique of rounds 1-3 — "we're building words from the foundation (morphemes) inward; fuseling feels accidental. Go outside-in: start from the theme/purpose and the _uses_." Method: name the objects that already exist in the scenes of using the server (slotting abilities, bringing parts to the synthesis shop, chaining combos, composing loadouts). Real evocative world-words are almost all npm-taken (athanor, azoth, assay, materia, loadout, hotbar, spellbook, quickslot, macro-family, hallmark, artificer, atelier). Survivors: **synthshop** (near-clean, npm free — names the literal FF synthesis-shop scene the mascot vision came from; "synth" also winks at modular-synth patching), **theorycraft** (npm free — the real gamer word for designing builds; trading-org squatters on GitHub), **mainhand** (near-clean — the always-equipped slot; litmus-test wrinkle: we're arguably the off-hand), macrobar/combolab/theoryforge (available, weaker). Artifact updated with round 4 cards.

**DIRECTION CHOSEN (2026-08-02): theorycraft** — as identity/narrative. Design the build (workflow) from parts (resources), sim it (gates/verification), take it into the run (export/execute). Primitive nomenclature does NOT change; npm stays `claude-prompts`. Owner confirmed the shopkeeper mascot survives the shift (League-shopkeeper precedent: a shop critter serving a practice, not a place).

**Deep-check result (2026-08-02): the NAME "theorycraft" is BLOCKED; the identity survives.**

- **USPTO serial 99386898 "THEORYCRAFT LABS" (TheorycraftLLC)** — recent application covering SaaS featuring **AI for software development, knowledge management, and workflow automation**. That is this project's exact category; a pending application still establishes priority. Direct class collision.
- **Theorycraft Games Inc** — VC-backed studio (Supervive, 2M+ players; ex-Riot/Blizzard/Bungie founders; theorycraftgames.com, @theorycraft_inc). Owns nearly all "theorycraft" search oxygen — we could never rank on our own brand query.
- **theorycraft-trading.ai** — a third company using TheoryCraft for an AI trading platform.
- GitHub user `theorycraft` taken (2019). npm `theorycraft`/`theorycraft-mcp` free, but irrelevant given the above.

**Resolution path**: use "theorycraft" **descriptively** in copy (community vocabulary — "theorycraft your workflows" as a verb is normal usage, not a mark) while the brand name comes from the adjacent ownable space. First probe, all npm-free: `theoryshop`, `theorybench`, `craftsim`, `buildsim`, `simforge`, `craftlab`, `simshop`. GitHub screen pending. Alternative: revert to **synthshop** (clean, round 4) as the name, with theorycrafting as the README's practice-language — shop + practice + shopkeeper mascot compose coherently.

**Round 5 — the shop idea, worldwide (2026-08-02)**: owner asked for a middle ground — the _idea_ of the shopfront/workbench without the literal English word; non-English roots welcome if they meet the phonetic recipe. Mined craft-shop vocabulary across Japanese/Scots/Portuguese/Esperanto. **Front-runner: `kobbo`** (工房 kōbō = artisan's workshop, respelled into the kobble/klobbo sound family — npm free, GitHub essentially clean at 2★ scraps; repo `kobbo-mcp`; shopkeeper-critter mascot fits natively; theorycraft stays as the practice language in copy). Runner-up: `zakka` (雑貨 — shop of useful little things; near-clean). Also clean: `smiddy` (Scots smithy; 1★ spec-dev-engine adjacent), `boteko` (PT). Kills: `yatai` (841★ BentoML), `koubou` (191★ craft tool), `konbini`/`karakuri`/`kojo` (npm taken), `kappo` (launcher). Artifact updated with round 5 cards.

**Round 6 — soft recipe (2026-08-02)**: owner refined the formula — hard /k/ not required; the essentials are **doubled consonant + trochaic bounce + soft feeling across the whole word** (moogle's side of the family, not kobble's). Soft-onset generation across coined words and soft craft vocabulary (loom parts, joinery, finishing). Survivors: **moffle** (MOF-fle — mofu = Japanese "fluffy"; near-clean, 7★ IRC archive), **niddy** (NID-dy — from the niddy-noddy, the real yarn-winder that turns loose yarn into ordered skeins; near-clean), **sibble** (SIB-ble — sibling warmth, litmus-test-as-a-feeling; npm free), plus available-but-quieter momme/gusset/wamble/mobbo. Kills: treadle (157★ Chisel engine + a 3★ workflow engine), ferrule (613★ parser), nubble (99★ app tutorial), bobbin/heddle/fettle/rabbet (npm taken). Artifact updated with round 6 cards.

**Round 7 — the mo·flow fusion (2026-08-02)**: owner direction "moflow/mofflow or down that path" — soft mo syllable × "flow" (the product word itself). Screen: `moflow` DEAD (npm taken + Cisco Talos 305★ + moflow org). **`mofflow`** npm-free, best word of the family (doubled f + literal "flow"), but exact-name collision with MOFFlow — 27★+18★ ML research repos (flow matching for metal-organic frameworks; arXiv presence means Google contention). **`mofuflow`** npm-free + ZERO GitHub hits (mofu = fluffy, explicit; 3 soft syllables). **`mofflo`** npm-free, no exact-name repos (same bounce, kupo-family -o ending, dodges the namespace). Also free: mooflow, womflow, mofu-flow. Artifact updated with round 7 cards.

**Round 8 — palindromes (2026-08-02)**: owner wants symmetry as built-in purpose. True palindromes screened, all npm-free: **flowolf** (f·l·o·w·o·l·f — "flow" forward, "wolf" mirrored; the symmetry maps to run-forward/verify-backward i.e. gates; caveat: active personal GitHub handle `flowolf`, 33★ repos, no project by that name), **woffow** (w·o·f·f·o·w — contains "woof", puppy mascot in the letters; no exact-name repos; soft recipe compliant), **moffom** (m·o·f·f·o·m — round-7 mof- sound made symmetric; near-clean). Also npm-free: mollom, ommo (53★ + hardware co — risky), muffum, mofom, loffol, mofumofu (69★ blog platform — dead), wolflow (wolflow-ai org, AI dev toolkit — dead). Artifact updated with round 8 cards. **Standing front-runners across all rounds: mofflow · mofflo · flowolf · woffow.**

**Round 9 — visual symmetry (2026-08-02)**: owner extended palindromes to _visual_ symmetry — mirror-pair letters (b↔d, p↔q; self-mirror o v w x i l u) and rotational ambigram pairs (m↔w, b↔q, d↔p, u↔n; self-rotating o x s z l i). **Front-runner: `mollow`** (m·o·l·l·o·w — a true rotational ambigram, reads identically flipped 180°; sounds like mellow × flow; soft recipe perfect: m onset, doubled ll, trochee; npm free, GitHub essentially clean at 0★ scraps; logo can be a wordmark that survives inversion). Runner-up: `wovow` (mirror-symmetric; contains "wove" = chains and "vow" = gates; near-clean). Kills: dollop/wollow/pooq (npm taken), moom (Moom is Many Tricks' Mac window manager — trademark), mollom (Acquia spam-service history). Owner also accepted `flowolf` despite the personal-handle caveat — **standing finalists: mollow · flowolf · mofflow · mofflo · woffow**.

**FINAL DECISION + RENAME EXECUTED (2026-08-03): WOLFFLOW.** After sleeping on the finalists, owner chose **wolfflow** (wolf × flow, doubled f — satisfies the doubled-consonant recipe where dead single-f `wolflow` didn't; more original than the mo-flow space; mascot-first). Screen: npm `wolfflow` free; GitHub only a dormant personal handle (~2014 LiveScript repos, 22★ max — same caveat class as flowolf, accepted). **Wolf narrative** (the "make WOLF matter" answer): wolves are nature's workflow — a pack hunt is a coordinated chain of roles (scouts → drivers → flankers) handing context step to step; `==>` delegation = sending a pack member; gates = the pack holds until the opening is verified. Flavor line: ~~"Prompts hunt better in packs"~~ rejected as cheesy → iterated through companion (Minecraft-wolf) and sage (Yoda-wolf) framings → derived programmatically from the interaction invariant (define once → enforced everywhere) + prosody engineering. **FINAL: "Written once, always followed."** — chiasmus (mirror-structured clauses, the syntax-level ambigram), trochaic throughout, ends on "followed" (Wolfflow anagram-contains "follow"), proverb register carries the sage-companion identity with zero wolf vocabulary, and it is a verifiable product claim (resources written once, enforced on every execution). Identity register for future brand surfaces: **adage/proverb voice** — wisdom by register, not costume.

**Method captured as tooling (2026-08-03)**: the session's programmatic approach is now reusable via MCP prompts. `>>readme_improver` gained a **Prose Hygiene pass** (AI-cadence tells table: em-dash connectors, "isn't just X", triads, manufactured aphorisms, reach-verbs like "mends"; the aphorism budget; read-aloud verification) plus a correction of its TIP-callout advice to match the Maya-test evidence (≤4, prefer prose links). New prompt **`>>branding_package`** encodes the full 7-phase funnel: ground-truth inventory → multi-recipe name generation (phonetic/hybrid/outside-in/multilingual/palindrome/visual-symmetry/product-fusion) → mechanical screening (npm/GitHub/trademark/google/adjacent-spelling) → recognition test → tagline derivation with prosody → voice integration rule → visual identity (mascot/colors/logo). README em-dash sweep also executed: 17 → 7, survivors are table-cell/definition-list/comment uses.

**Voice integration rule (2026-08-03, after the caption experiment failed)**: constructed aphorisms live in the tagline ONLY — a second aphorism (hero caption, "The gate catches; the model mends") immediately read as cheese and was reverted same-day. Everywhere else: **voice through diction, not devices** — charter-plain prose that prefers the identity lexicon (_follow, catch, hold, carry, thread, guide_) when synonyms tie. The lexicon was extracted from the product's own existing language ("thread context," "gates catch errors"), so compliance is mostly free. Never invent aphorisms in sections, captions, or docs.

Executed same day:

- GitHub repo renamed `minipuft/claude-prompts` → **`minipuft/wolfflow-mcp`** (permanent redirects cover old URLs); local remote updated; description prefixed "Wolfflow —"; homepage → new `/tree/main/docs`.
- URL sweep: 16 active files in this repo (CHANGELOG + plans/archive intentionally exempt per cleanup-standards historical exception) + minipuft-plugins/gemini-prompts/opencode-prompts READMEs + GEMINI.md.
- README identity: H1 → **Wolfflow**, flavor line added, npm-continuity note added, from-source/dev-setup clone paths fixed to `wolfflow-mcp`. `validate:readme --mode=block` passes (364 lines).
- **Unchanged by design (public API contract)**: npm package `claude-prompts`, CLI binaries `claude-prompts` + `cpm`, Claude Code plugin id `claude-prompts@minipuft`. Renaming any of those is a breaking change requiring a major bump — deliberately out of scope for a brand rename. Revisit only with a planned major.
- **Unblocked**: Tier 2 listings can now be born with the final URL. Mascot art (wolf-pup courier) is the remaining brand asset — logo.png still shows the old logo.

**RENAME REVERTED (2026-08-04): back to `claude-prompts`.** Owner decision, one day after execution and before anything was pushed or listed. Three reasons: (1) **collision** — an existing AI workflow-automation product already operates under a wolf(f)low-style name, exactly the adjacent-spelling trap the screening funnel checks for (the funnel screened `wolfflow` exact but under-weighted the single-f neighbor as a live product); (2) **clarity regression** — `wolfflow` requires explanation, `claude-prompts` states the category on sight, and this project's acquisition problem is discovery, not memorability; (3) **family consistency** — downstream repos are `opencode-prompts`, `gemini-prompts`, `codex-prompts`; the upstream reverting to `claude-prompts` restores one `-prompts` naming scheme across all four. **Kept from the rebrand**: the tagline "Written once, always followed." (stands on the product claim without the anagram tie), the adage-voice register, the mascot option (undecided), the spelled-out "Model Context Protocol (MCP) server" description standard, and all metadata/keyword work. GitHub renamed back same day (redirect now points `wolfflow-mcp` → `claude-prompts`); homepage + description updated; full reference sweep across this repo + the three downstream repos; README H1 → "Claude Prompts", npm-continuity note removed (no longer needed). **Funnel lesson recorded**: adjacent-spelling screening must treat a live product on ANY spelling neighbor as a kill, same severity as an exact npm/GitHub hit.

**SUFFIX RECLAIMED (2026-08-05): `claude-prompts` → `claude-prompts-mcp`.** Not a rebrand — the brand stays "Claude Prompts"; this reclaims the repo's own former name (redirect was still ours, local dir never changed, mcp.so/mcpservers.org slugs still carry it) to put the `mcp` token back in the name before Tier 2 listings pin URLs. Evidence: name-token match is the measured strongest GitHub ranking lever (24★ repo ranks on our target query by name alone); 5/7 surveyed high-adoption servers suffix `-mcp`; disambiguates from the prompt-collection space. **Downstream repos deliberately keep their names** (opencode-prompts, gemini-prompts, codex-prompts): they are client-native plugins discovered in client channels where the `mcp` token matches no query — suffixing them is churn without benefit. Registry identity aligned: `io.github.minipuft/claude-prompts-mcp`. npm package, CLI bins, plugin id unchanged (contract).

**Naming funnel** (for the next pass): (1) generate wide using the morphological toolkit — agentive suffixes (-smith/-wright/-ery), Latin/Greek roots (syn-, -texere), portmanteaus, real-word repurpose; (2) mechanical screen: npm 404 + GitHub name search + trademark sanity + google-uniqueness; (3) **recognition test** — present survivors as README-header mockups (name + tagline + mascot sketch in place), not a bare list, because "good name" is an unknown-known: recognized on sight, not stateable in advance; (4) whichever wins, repo becomes `<name>-mcp` or keeps a `prompt` token so the measured name-token search equity survives.

### Tier 1 EXECUTED 2026-08-02 (rebrand-neutral surfaces; rename excluded)

Shipped while the window is paused, bundled with the README defect fixes into one dated event:

- GitHub description → keyword-forward draft (as above, with "workflow chains" + all four client names). ✓
- GitHub homepage → `/tree/main/docs`. ✓
- GitHub topics += `mcp-server`, `agentic-workflows`, `claude-code` (now 16/20). ✓
- npm `keywords` 7→14 (added `mcp-server, prompt-templates, prompt-management, prompt-engineering, claude-code, workflow, chains, quality-gates, skills`; dropped `language-model, server`); npm `description` replaced ("Claude Custom Prompts MCP Server" → same keyword-forward sentence). Takes effect on next npm publish. _(uncommitted until finalize)_
- **Scorecard re-run due ~2026-08-16** (baseline: GitHub #5/#3/absent; npm >20 everywhere).

### Keyword strategy (evidence-based, measured 2026-08-02)

**Method**: rank ourselves in GitHub/npm search for candidate queries; size the topic pages; see what winners use. Findings:

| Query (GitHub search)  | Our rank | Verdict                                                                                                                                                                                    |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mcp prompt server`    | **#5**   | Winnable — push toward #1-3                                                                                                                                                                |
| `prompt templates mcp` | **#3**   | Winnable — already near top                                                                                                                                                                |
| `mcp workflow`         | absent   | **Unwinnable** — owned by 4k–46k★ apps (activepieces, n8n-mcp, mcp-agent); don't optimize for it                                                                                           |
| `claude prompts`       | absent   | **Wrong intent** — that query space is prompt _collections_ and system-prompt leaks (5k–166k★). Our repo name pulls us toward a space we can't win and whose searchers want something else |

| Topic               | Repos on page | Read                                         |
| ------------------- | ------------- | -------------------------------------------- |
| `prompt-templates`  | 113           | Tiny — 182★ ranks near top. Already tagged ✓ |
| `prompt-management` | 272           | Tiny — near top. Already tagged ✓            |
| `agentic-workflows` | 1,206         | Mid — visible. **Add**                       |
| `mcp-server`        | 22,520        | Large but high-intent. **Add**               |
| `claude-code`       | 54,786        | Huge — buried, but costs nothing. **Add**    |
| `ai-agents`         | 63,573        | Huge — invisible at 182★. Skip               |

**Strategy**: own the small high-intent spaces (`prompt-templates`, `prompt-management`, "mcp prompt server" queries); be present in mid spaces; don't chase volume topics where 182★ is invisible. The winnable identity is "**MCP server** for prompt templates/workflows" — which confirms the description draft leading with "MCP server", not "Claude".

**npm** (`registry.npmjs.org/-/v1/search`): absent from top 8 for `mcp prompts`, `mcp workflow`, `prompt management`, `mcp server prompts`. npm's score is popularity-dominated, so keywords only fix _matching_, not rank — realistic target is top-10 for `mcp prompts` only. Current `server/package.json` keywords (7, generic): `claude, ai, mcp, model-context-protocol, prompts, language-model, server`. **Add**: `mcp-server`, `prompt-templates`, `prompt-management`, `workflow`, `chains`, `claude-code`, `agents`. Drop `language-model` (nobody searches it).

### Scorecard (repeatable, re-run after Tier 1 ships)

No single "SEO score" exists for a repo, but this fixed query set is scriptable and diffable:

```bash
# GitHub rank (fixed queries)
for q in "mcp+prompt+server" "prompt+templates+mcp" "mcp+prompt+management"; do
  gh api "search/repositories?q=$q&per_page=20" --jq '[.items[].full_name] | index("minipuft/claude-prompts-mcp")'
done
# npm rank
curl -s "https://registry.npmjs.org/-/v1/search?text=mcp%20prompts&size=20" | jq '[.objects[].package.name] | index("claude-prompts")'
```

**Baseline 2026-08-02**: GitHub `mcp prompt server` #5 · `prompt templates mcp` #3 · npm all queries >20. Lagging outcome metric stays the A8 referrer uniques (Google 28/14d). Google itself is unscoreable without Search Console, which needs an ownable site — one more argument for an eventual GitHub Pages docs site, not for now.

**Exit**: description/homepage/topics/keywords updated in one pass after window close, recorded here, dated — so any traffic change in the following weeks is attributable. Re-run scorecard ~2 weeks after shipping.

---

## Tier 2 — Aggregator Listings Audit + Per-Platform Integration (2a DONE · 2b PREPARED, fires at ship)

Two sub-phases: **audit** (read-only, may run during the observation window) and **integrate** (after window closes).

### 2a. Audit — what does each platform currently show?

For each platform: are we listed at all · what license is displayed · what description/version is cached · is the listing claimed/owned by us. Record findings in a table appended to this section.

**AUDIT EXECUTED 2026-08-04** (read-only, three parallel research passes; window-safe):

| Platform                                        | Listed                                   | What it shows                                                                                                                                                                                                                                                     | Fix path (verified current)                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Official MCP Registry**                       | **NO**                                   | absent under any name                                                                                                                                                                                                                                             | `"mcpName": "io.github.minipuft/claude-prompts-mcp"` in the **published** npm `package.json` + `server.json` at repo root (schema 2025-12-11; `name` must equal `mcpName`) + `mcp-publisher login github && publish`. Validates the npm tarball, so it takes effect only with the next npm publish                                                                                                                         |
| **npm**                                         | yes, 3.1.1 (2026-08-03)                  | **stale description** "Claude Custom Prompts MCP Server" + old 7-keyword set — the rewritten description/keywords sit uncommitted in `server/package.json` and missed the 3.1.1 train. Not in top-20 for "mcp prompts", "mcp workflow", or "prompt templates mcp" | ship the pending metadata with the next publish                                                                                                                                                                                                                                                                                                                                                                            |
| **Glama**                                       | yes                                      | **current MIT (License A)**, fresh description, but **unclaimed**, "This server cannot be installed" flag, Maintenance C                                                                                                                                          | 2-line `glama.json` at root (`{"$schema":"https://glama.ai/mcp/schemas/server.json","maintainers":["minipuft"]}`) + GitHub OAuth claim                                                                                                                                                                                                                                                                                     |
| **PulseMCP**                                    | yes                                      | **stale Mar-2025 description**; page says they proxy an interim server.json "until the maintainer publishes it to the official MCP registry"                                                                                                                      | official-registry publish fixes it durably; `pulsemcp.com/submit` for interim correction                                                                                                                                                                                                                                                                                                                                   |
| **Smithery**                                    | **NO**                                   | — (stdio servers CAN list without their hosted runtime)                                                                                                                                                                                                           | **CORRECTED 2026-08-05**: `smithery.yaml` is legacy — current docs (smithery.ai/docs/build/publish) don't mention it. Stdio path is now an **MCPB bundle** upload (`smithery mcp publish ./server.mcpb -n <org>/<name>` or web upload), and `extension-publish.yml` already attaches `claude-prompts-<v>.mcpb` to every release. The stray `server/src/smithery.yaml` was deleted earlier; the root one deleted 2026-08-05 |
| **mcp.so**                                      | yes (slug `claude-prompts-mcp`)          | stale title "Claude Custom Prompts MCP Server", **license shown: AGPL-3.0** — the feared license-staleness confirmed here                                                                                                                                         | `mcp.so/submit?type=server`                                                                                                                                                                                                                                                                                                                                                                                                |
| **mcpservers.org** (wong2 site)                 | yes (slug `minipuft/claude-prompts-mcp`) | v1-era description ("loads prompts from an external JSON configuration file")                                                                                                                                                                                     | `mcpservers.org/submit` form (the GitHub list itself takes no PRs)                                                                                                                                                                                                                                                                                                                                                         |
| **punkpeye/awesome-mcp-servers**                | NO                                       | —                                                                                                                                                                                                                                                                 | PR (Developer Tools category); agent PRs fast-tracked via `🤖🤖🤖` title suffix                                                                                                                                                                                                                                                                                                                                            |
| **cursor.directory**                            | NO                                       | —                                                                                                                                                                                                                                                                 | site submission (`/plugins/new`, GitHub sign-in); detects components via Open Plugins standard (`.mcp.json`, `skills/*/SKILL.md`)                                                                                                                                                                                                                                                                                          |
| **mcpmarket.com**                               | yes                                      | v1-era "Custom Prompts for Claude AI" description                                                                                                                                                                                                                 | `mcpmarket.com/submit` refresh                                                                                                                                                                                                                                                                                                                                                                                             |
| **awesome-claude-code** (hesreallyhim)          | NO                                       | —                                                                                                                                                                                                                                                                 | **human-only** issue form (agent submissions explicitly banned); resource must be ≥14 days old + active, or ≥100★ — we qualify. Owner files this one personally                                                                                                                                                                                                                                                            |
| **modelcontextprotocol/servers** community list | —                                        | **row retired**: the community list no longer exists; README/CONTRIBUTING redirect to the official registry                                                                                                                                                       | no action possible — registry publish covers it                                                                                                                                                                                                                                                                                                                                                                            |

Incidental sightings (unaudited): LobeHub, Playbooks.

**Recurring defect**: v1-era scrapes never refreshed — three sites show v1 descriptions, one still shows AGPL. Root cause is upstream: no owner-controlled metadata files in the repo and no official-registry entry for aggregators to source from. The official-registry publish is the single highest-leverage fix (PulseMCP explicitly waits on it; others increasingly source from it).

**Integration package for the ship event** (2b, executes with the push + next npm publish so the window measures one dated event): `mcpName` field (rides with the pending package.json metadata — additive, not a contract break), `server.json` at root, `glama.json` at root, proper stdio `smithery.yaml` at root (superseding the stray), then post-publish: `mcp-publisher publish`, Glama claim, the four correction forms, punkpeye PR. awesome-claude-code stays a manual owner task.

### 2b. Integration paths per platform (VERIFIED 2026-08-04/05; files prepared in-repo)

**Repo now carries the integration files** (committed with the `-mcp` suffix rename): `server.json` (registry schema 2025-12-11, name `io.github.minipuft/claude-prompts-mcp`), `glama.json` (maintainer claim), and `"mcpName"` in `server/package.json`. `sync:versions` + `validate:versions` cover `server.json` (top-level + package versions + name↔mcpName equality), so release bumps keep the registry manifest true automatically. `smithery.yaml` was created in the same batch but **deleted 2026-08-05** — legacy format; Smithery now takes the MCPB release artifact directly (see step 4).

**Registry-surface inventory (why these files live where they do)** — every platform mandates its own location; there is nothing to reorganize into a subdirectory:

| File                            | Consumer                                   | Location mandated by                      | Version kept true by                                     |
| ------------------------------- | ------------------------------------------ | ----------------------------------------- | -------------------------------------------------------- |
| `server.json`                   | Official MCP Registry                      | `mcp-publisher` reads repo root           | `sync:versions` + `validate:versions` (name↔mcpName too) |
| `glama.json`                    | Glama claim/scan                           | Glama scans repo root                     | versionless — nothing to sync                            |
| `manifest.json`                 | MCPB bundle (Smithery, DXT/Claude Desktop) | `mcpb pack` reads bundle root = repo root | `sync:versions` + `validate:versions`                    |
| `server/package.json` `mcpName` | Official MCP Registry (tarball validation) | npm package manifest                      | `validate:versions` equality check vs `server.json` name |
| `.claude-plugin/plugin.json`    | Claude Code plugin marketplace             | plugin spec                               | `sync:versions` + `validate:versions`                    |

**Execution checklist — ship day** (order matters; each step dated when done):

| #   | Step                                                                                         | Mechanism (verified)                                                                                                                                                                                                                 | Status                                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Push repos (codex-prompts created+pushed → minipuft-plugins → this repo) + npm publish 3.1.2 | carries mcpName + new description/keywords into the tarball                                                                                                                                                                          | ◐ 2026-08-05: codex-prompts created+pushed · minipuft-plugins pushed (3.1.1 + codex entry live) · `release-3.1.0-final` pushed with mcpName/metadata committed (`b4171ca8`, crashed-session recovery). **Remaining: merge the branch → main, then 3.1.2 publish** |
| 1   | **Official MCP Registry** publish                                                            | `mcp-publisher login github && mcp-publisher publish` against root `server.json`; verify `GET /v0/servers?search=claude-prompts`                                                                                                     | ☐                                                                                                                                                                                                                                                                 |
| 2   | **Glama** claim                                                                              | GitHub OAuth on glama.ai (glama.json already in repo); expect "cannot be installed" flag + Maintenance C to clear with metadata control                                                                                              | ☐                                                                                                                                                                                                                                                                 |
| 3   | **PulseMCP**                                                                                 | fixes itself once #1 lands (they proxy our server.json); else `pulsemcp.com/submit`                                                                                                                                                  | ☐                                                                                                                                                                                                                                                                 |
| 4   | **Smithery**                                                                                 | publish the release MCPB artifact: `smithery mcp publish ./claude-prompts-<v>.mcpb -n minipuft/claude-prompts` (or web upload at smithery.ai/new); the bundle is already attached to every GitHub release by `extension-publish.yml` | ☐                                                                                                                                                                                                                                                                 |
| 5   | **mcp.so** correction                                                                        | `mcp.so/submit?type=server` — kills the cached AGPL + v1 title on slug `claude-prompts-mcp` (slug now matches repo)                                                                                                                  | ☐                                                                                                                                                                                                                                                                 |
| 6   | **mcpservers.org** correction                                                                | `mcpservers.org/submit` form (the wong2 GitHub list takes no PRs)                                                                                                                                                                    | ☐                                                                                                                                                                                                                                                                 |
| 7   | **mcpmarket.com** correction                                                                 | `mcpmarket.com/submit` with repo URL                                                                                                                                                                                                 | ☐                                                                                                                                                                                                                                                                 |
| 8   | **punkpeye/awesome-mcp-servers**                                                             | PR, Developer Tools category, one-line description; agent PRs fast-tracked via `🤖🤖🤖` title suffix                                                                                                                                 | ☐                                                                                                                                                                                                                                                                 |
| 9   | **cursor.directory**                                                                         | `cursor.directory/plugins/new` (GitHub sign-in); detects via Open Plugins standard — check our `.mcp.json` shape qualifies first                                                                                                     | ☐                                                                                                                                                                                                                                                                 |
| 10  | **awesome-claude-code**                                                                      | **owner-manual**: issue form `hesreallyhim/awesome-claude-code` (recommend-resource.yml); agent submissions banned; we meet the ≥100★/active bar                                                                                     | ☐                                                                                                                                                                                                                                                                 |

Retired: modelcontextprotocol/servers community list (no longer exists; #1 replaces it).

**The single gate in front of steps 1–9 (as of 2026-08-05): the `release-3.1.0-final` → `main` merge.** Every repo-file-based integration reads the DEFAULT branch — the registry publish needs `server.json` on main, Glama's claim flow reads `glama.json` from main, Smithery scans main for `smithery.yaml`, and every scraper correction re-fetches main's README (still the old pre-restructure one). The branch is pushed and merge-ready (0 behind main after the 2026-08-05 merge; committed versions consistent at 3.1.2). Sequence: PR + merge → release-please/publish flow ships 3.1.2 → run steps 1–9 same day → owner files step 10 by hand. The observation window restarts from that merge-publish date.

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

| Claim                                                       | Reality                                                                                    | Evidence                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `%guided — Force framework injection` (Syntax Reference)    | Parser throws `ValidationError` on `%guided`; the real fourth modifier is `%framework`     | `server/src/engine/execution/parsers/command-parser.ts` L38-43, L126            |
| "Chains also support conditional branching"                 | `?` operator is `"status": "reserved"` — unimplemented; no condition field in chain schema | `tooling/contracts/registries/operators.json`, `docs/reference/chain-schema.md` |
| `#concise` style example                                    | Shipped styles: `analytical, creative, procedural, reasoning` — no `concise`               | `server/resources/styles/`                                                      |
| `--init` "scaffolds prompts, gates, frameworks, and styles" | Creates 3 starter prompts + `config.json` only                                             | `server/src/cli-shared/workspace-init.ts` L73-99                                |
| "90+ prompts across 11 categories"                          | 122 prompt.yaml across 17 category dirs                                                    | `server/resources/prompts/`                                                     |
| `%judge` "applies the best combination automatically"       | Contract marks `%judge (preview)` — shows a guidance menu, doesn't execute                 | `tooling/contracts/prompt-engine.json`, `docs/reference/mcp-tools.md` L280      |
| resource_manager "export resources"                         | No `export` action exists; export lives in skills-sync                                     | `tooling/contracts/resource-manager.json`                                       |
| One-modifier-per-command unstated                           | Stacking `%lean %judge` is a hard parse error                                              | `command-parser.ts` L136-140                                                    |
| (docs, not README) `system_control action:"whoami"`         | Not routed — identity-scope guide tells users to verify with an action that doesn't exist  | `system-control-router.ts` L354-372                                             |

#### UNNOTATED — highest-value capabilities the README never surfaces (feeds 3b prioritization + Tier 1 keywords + Tier 2 listing copy)

- **Shell gate response injection** (`shell_stdin_source: agent_response` + shipped `path-verification` gate + `verify-path-claims.mjs`) — verifies agent _claims_ against the filesystem; the strongest anti-hallucination story in the repo. Meanwhile the README leads with `:: 'cite sources'`, a self-reported check a fabricated PASS slips through. **The README trades its best evidence for its weakest claim.**
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

- README "Judge Mode" (`%judge` resource selection) links to `judge-mode.md`, which documents a _different feature_ (context-isolated gate evaluator) sharing the name.
- "blocking or advisory" — three modes exist (+ `informational`); README never says how to choose or what advisory does on FAIL.
- `loop:true` "spawns a fresh context" — undersells a real `claude --print` spawn with budget cap, session story, and cost telemetry (`hooks/ralph-stop.py`).
- `:: verify` in chains applies to first execution only, not re-parsed on resume — a footgun in the README's own headline example, unflagged.

#### Decision needed: defect carve-out vs window purity

The observation window (A7) forbids README changes to keep the MIT signal clean. But the OVERSTATED class is **factual defects** — `%guided` throws an error for anyone who types it _during the window_, costing exactly the evaluators the window is trying to measure. Options:

1. **Strict**: hold everything to window close (~Aug 14-28). Zero confound; broken claims stand for 2-4 weeks.
2. **Defect carve-out (recommended)**: fix only the OVERSTATED table now — small diffs, no restructuring, no new sections. Accuracy fixes don't plausibly move _acquisition_ metrics (search/listings don't read README prose), so the confound risk is near zero while the trust cost of broken examples is real. All UNNOTATED/UNCLEAR/BETTER-EXAMPLE work still waits for 3b.

**DECIDED 2026-08-02 (owner)**: defect carve-out executed. Observation window formally **paused** while the fixes land; it **restarts from the day the fixes ship** (new window: ship date + 2-4 weeks). Fixes applied to README.md same day: `%guided`→`%framework` + one-modifier rule, conditional-branching claim removed, `#concise`→`#procedural`, `--init` claim corrected to actual scaffold output, 90+/11→120+/17, `%judge` reworded to recommend-then-confirm, `resource_manager` "export"→"roll back", styles attributed to `cpm` CLI not resource_manager. `validate:readme --mode=block` passes (362 lines). The docs-side `whoami` defect (identity-scope guide references an unrouted action) is out of README scope — fix alongside 3b or as a standalone docs correction.

### 3b. README content pass (only if 3a finds material gaps)

- Fixes flow through the existing charter + `validate:readme` guardrails; 400-line budget still binds.
- Anything that doesn't fit the budget goes to `docs/` with a pointer — the Tier 3 answer to "more to say" is never "longer README".
- Optional re-validation: fresh Maya-style roleplay agent against the revised README (per `readme-restructure.md` B3.5 follow-up).

**Trigger to activate this tier**: observation window closed, AND (3a finds gaps OR listing integrations drive traffic whose bounce suggests conversion problems).

---

## Tier 4 — Dependabot Vulnerability Triage (audited 2026-08-05; window-neutral, land BEFORE the merge)

GitHub shows "3 vulnerabilities (1 high, 1 moderate, 1 low)" on the repo's security tab — a badge
visible to exactly the evaluators the Tier 2 listings will send. Unlike Tiers 1–3 this is
window-neutral (no README/metadata surface changes), and it should land **before** the
merge→publish ship event so the listings never point at a repo wearing a high-severity flag.

**Audit (per-alert, traced 2026-08-05):**

| #   | Package         | Severity | Scope                      | How it enters                                                                                                                                                                                                                                    | Actual exposure                                                                                                                                 | Remediation                                                                                                                                                                                                                                            |
| --- | --------------- | -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 165 | `tmp` <0.2.6    | **high** | dev, root lockfile         | `@anthropic-ai/mcpb@2.1.2` → `@inquirer/prompts` → `external-editor` → `tmp@0.0.33`                                                                                                                                                              | Packaging-time only (`mcpb pack` in CI, non-interactive — the vulnerable editor-prompt path never runs). The cost is the badge, not the exploit | Root `package.json` `"overrides": { "tmp": "^0.2.6" }` — mcpb 2.1.2 is **latest** and still pins the chain, so no upstream bump exists to wait for. Verify `npm ls tmp` → 0.2.6, then smoke `build-extension.sh` (external-editor loads tmp at import) |
| 164 | `tmp` <=0.2.3   | low      | dev, root lockfile         | same chain                                                                                                                                                                                                                                       | same                                                                                                                                            | same override closes both                                                                                                                                                                                                                              |
| 166 | `hono` <4.12.34 | medium   | "runtime", server lockfile | **not installed** — only an _optional peerDependency_ range declared by `@modelcontextprotocol/node`; no `node_modules/hono`, no lockfile package entry, no `src/` import; `dist/index.js` matches are the `@hono/node-server` adapter, not hono | None — the vulnerable CORS middleware isn't in the artifact. Alert fires on the declared peer range, not shipped code                           | Dismiss with reason `vulnerable code is not actually used` + note; **re-verify on every MCP SDK upgrade** (an SDK that starts hard-depending on hono re-arms it)                                                                                       |

**Execution**: (1) add the override + `npm install` at root to regenerate the lockfile · (2)
`npm ls tmp` shows ≥0.2.6 and alerts 164/165 auto-resolve on push · (3) run
`scripts/build-extension.sh` as the compat smoke (tmp 0.0.x→0.2.x had API changes; external-editor
only needs `fileSync`, which survives, but prove it) · (4) dismiss 166 via
`gh api -X PATCH .../dependabot/alerts/166` with the not-used reason · (5) date each here.

**Standing rule this tier leaves behind**: dev-scope alerts on the packaging chain get fixed via
root `overrides` (upstream mcpb pins are slow); "runtime" alerts get traced to the artifact before
believing the label — the hono alert's `runtime` scope was wrong about what we ship.

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
