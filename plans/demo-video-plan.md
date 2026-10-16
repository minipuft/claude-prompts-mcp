---
title: Claude Prompts creative showcase
date: 2026-09-29
status: active
revision: v2-study
type: implementation
initiative_branch: docs/creative-showcase
worker_cap: 3
planner_session: creative-showcase
---

# Claude Prompts creative showcase

## Now (2026-10-13)

Goal: unchanged. D59–D62: production = `showcase_preproduction` (once per episode) + `showcase_asset_muse` (per object) + `showcase_shot` (per shot, feeds measured ranges back to shots.json/script.md, multi-frame render study, optional Blender tool); all six resources created canonically (payloads 11–16). Pre-production run 1 DONE 2026-10-13 (chain-showcase_preproduction#1 on the isolated server via `workflow-client.mjs drive` + mailbox; receipt `v3/studies/preproduction-01.md`): board-04, `v3/beats.json`, `v3/shots.json` (8 shots, 12-object inventory). D63/D64 2026-10-13: companions morph (muse pass each), fewest cuts → shots-02 (4 shots, 0 cuts, moves along leading lines). D66–D68 2026-10-13: codex exec is the default source via the `imagegen` script tool; generation kinds widened (sheets, silhouettes, environments, depth/normal, splats as reference); no video model: plates are cut into layers and moved by motion.ts. D65 2026-10-13: hand-coded SVG rejected as the drawing tool; assets come from Codex's image tool (`codex exec -i … -- prompt`, multi-reference verified: `v3/studies/drawing-source-01.png`), cut into role-quantized layers (rembg + VTracer), rigged as a Remotion cutout puppet; LoRA HELD. tech_recommendation chain-tech_recommendation#1. DONE 2026-10-13: `imagegen` tool attached to showcase_asset_sheet v2 (payload 19); `scripts/cutout.py` (control passes); `src/library/Puppet.tsx`; first generated human sheet `v3/studies/human-gen-16.{png,md}` (three directions; default pick middle Swoop) — owner picked middle Swoop, arriving in the Cloak (D69). Face grid `v3/studies/human-gen-17-faces.png` (row pick pending, default row 2) and parts sheet `v3/studies/human-gen-18-parts.png` cut into `assets/human/` (15 parts) → first puppet `v3/studies/puppet-proof-02.{mp4,md}`: lift on twos measured (C16/C17 HOLD on generated parts). D70 DONE (revised to row 2, owner 2026-10-13): four face states cut (`assets/human/face/`, marks dilated 3% of head width), identity pass at 40 px passes. D71 DONE 2026-10-13: every part has hard / soft-alpha / contour-halo / vector files; `HumanPuppet` takes `render` (default soft+contour) and draws lower-z children behind their parent (the hair was covering the face); `RigSheet` (`v3/studies/rig-sheet-02.png`: pivots, part ids, the three renderings with head windows, pose strip, face states) is the editing view for rigs — owner pick of the rendering pending, default soft+contour. tech-rig-01 (2026-10-13, `v3/studies/tech-rig-01.md`): the rig is not 1:1 because parts came from a separate sheet generation and rig.json was hand-typed with no shared joints, no joint overlap and no registration; verdict TRIAL AnimatedDrawings (Smith 2023, MIT) as rig SSOT (mask + 17 joints → generated rig.json, parts cut from the approved plate by nearest bone with joint caps, rest-pose IoU ≥ 0.97 gate), Remotion stays the renderer — owner approval pending (toolchain: conda + Docker TorchServe; retires the parts-sheet step). D72 DONE 2026-10-13 (owner: CalArts-grade craft, pose-to-pose consolidated into sheets; timing charts and clean-up adopted): spec v4-brief-18 (D72 + Craft baseline section), rubric v1.4 (C20–C23), prompts updated canonically (payloads 20–27, receipts call-{Lxq3nR,V4ZNEn,fUQZtr,UEOmQ5,H4LYXA,258Aw6,CUHFj9} + muse): NEW `showcase_model_sheet` (per character, imagegen, model.json), NEW `showcase_key_sheet` (per shot and actor, imagegen from the model sheet, overlay/silhouette/clean-up checks, cut to key plates, joints when the skeleton toolchain exists), `showcase_motion` = timing charts with key lists (`v3/charts/<shot>.json`), `showcase_render_study` = puppet holds/inbetweens between key plates with chart-conformance probes, `showcase_shot` chain = motion → keys → render → grade → evidence, gate + review read C20–C23. The rig trial (tech-rig-01) is folded under D72 as the registration tool. D73 2026-10-13 (owner: no 3D characters, go straight to the 2D deformation rig): tech-rig-02 (`v3/studies/tech-rig-02.md`, chain-tech_recommendation#1) ADOPT — port the AnimatedDrawings ARAP core (MIT, 329 lines) to `src/library/motion/arap.ts`, mesh the mask with earcut, pins at the skeleton joints, render as a textured BufferGeometry via @remotion/three; key plates are sibling figures on the same skeleton; GPL puppet-warp, Rive, Spine, DragonBones avoided, SkelForm/ToonCrafter/EbSynth held. Craft reference set `v3/references/calarts/` (Continue?, GIANT CRUSH, 2025 award films, 480p study copies) measured in `v3/studies/craft-ref-01.md`: pose-to-pose with 11–27 frame holds and 3–6 drawing transitions, camera on ones; nothing measured needs 3D. Owner's Eagle library read 2026-10-13 (`v3/studies/owner-library-01.md`, index + sheets under `references/owner/`): two-axis filing (source × facet), 258 CalArts frames confirm two-colour fields and screen-space light; unfiled clusters (Boondocks model sheets, Hercules Hades, Turrell/Eliasson light volumes, the 2026-07-29 cloak SD prompt) guessed and proposed as board cards; owner confirmed the cluster guesses 2026-10-13 and asked for a synced board: `~/.claude/skills/inspiration/scripts/eagle_board.py` (global /inspiration skill, `--out v3/references/owner`; sync incremental via mtime.json + file clocks, thumbs under `references/owner/thumbs/`, `eagle-board.html` with source×facet matrix, month strip, folder tree, unfiled clusters from `clusters.json`, hash-addressable filters, eagle:// deep links; `pick`/`cards` promote items to `picks.json` → board.json card stubs with Eagle provenance; `npm run eagle:sync|eagle:watch|eagle:serve` → http://localhost:3108/eagle-board.html). 20 picks filed (light, line, cloak, colour). Intake 2026-10-13: `eagle_board.py add URL --folder --why --source` (same skill script) files inspirations INTO Eagle via its local API (token in ~/.config/eagle/token, pending from the owner), inbox fallback verified against the live 401; `add --from answer.md` reads ``inspirations blocks. D74 DONE 2026-10-13 (owner: proceed): 20 Eagle pick cards folded into `references/board.json` (board-06: light → §3 field, line + cloak → §5 cast, colour → new §7 colour script), spec v4-brief-19 (D73 + D74 + Colour script table), rubric v1.5 (C24 hue pair per shot), `shots.json` carries `hue.radiance/accent` per shot (s01 Turrell blue, s02 Styx steel, s03 Eliasson amber, s04 Soup! coral). Global `/inspiration` skill + `inspiration-provenance` rule own filing from now on. Model sheet run 1 DONE 2026-10-13 (`v3/studies/human-model-01.{png,md}`, receipt call-XB3Fat + imagegen-model-01.json; `assets/human/model.json` provisional; `ModelSheetHuman` composition + `scripts/model_measure.py` + `scripts/model_contract.py`): three views within 0.4 %, identity held, contour 2.83 px vs the written 1/120 target (3.92) → C22 fails as written but matches the approved plate (1/240): owner 2026-10-13: sheet APPROVED (D75, `provisional: false`); C22 re-based (D76) to the approved sheet's own measured line (1/166 for the human; the generator's line is ~2.8 px at plate resolution, so a fixed fraction moves with figure height), spec v4-brief-20, rubric v1.6, `showcase_model_sheet` prompt updated canonically (payload 29). ARAP rig port DONE 2026-10-13 (worker; `v3/studies/puppet-proof-03.{md,mp4,-strip.png}`; `src/library/motion/{arap,mesh}.ts`, `motion.ts` `poseAt`, `cast/MeshFigure.tsx`, `cast/humanPose.ts`, `scenes/MeshProof.tsx`, `assets/human/{skeleton,mesh}.json`, measure scripts): silhouette 1 component on all 90 frames (re-measured by planner; puppet-proof-02 had 3 after frame 32), rest IoU 0.9879 at 418 vertices, joint error 0 px, solve median 1.3 ms, port vs float64 reference 0.0002 px (the shipped float32 reference itself errs by up to 219 px at rest). Open: raises past ~105° drag the poncho (single layer) → default per D72: a raise is a drawn key, no arm layer split yet; 15/17 joints placed by eye → next derive the skeleton from the approved model sheet's construction row (cells 4–6, joints drawn as circles) and re-run the registration gate; the chart's auto-thirds hold 4 frames, author breakdowns on twos. D77 2026-10-13 (owner: the next sheet shows the full cinematography consideration): cinematography sheet per shot → NEW `showcase_layout_sheet` (payload 30, receipt call-wkhsZk), shot chain now layout → motion → keys → render → grade → evidence (payload 31, call-qqKsJy; review's motion_contract = step2_result), motion reads `v3/layouts/<shot>.json` (payload 32, call-F7VBp3), spec v4-brief-21, rubric v1.7 (C25), board-07 §8 camera cards (4 Composition picks, Eagle provenance), `src/scenes/LayoutSheet.tsx`. s02 sheet DONE 2026-10-13 (`v3/studies/s02-layout-01.{png,md}`, `v3/layouts/s02-cant-build-frame.json` provisional, `LayoutSheetS02` still, `scripts/layout_measure.py`; prompt receipt call-CP9gtK, generation imagegen-layout-s02-01.json): four panels as asked; human 63 % of frame at the reach, ~72 % at the end (script merges human + frame there); emitter dial (0.35, 0.89) → frame interior (0.60, 0.48); owner approval pending (default approve). Key sheet prompt updated canonically 2026-10-13 (payload 34): reads the layout, two rows (keys at model scale to cut; frame keys at the layout camera as the C25 staging proof), companions from official plates, cloak as roles, optional world style for row 2. Candidate D78 (owner idea 2026-10-13, panel 3's loose line style read as another world): worlds the human visits while building workflows, each with its own style (crayon, a Tron-like line world where lines connect everything); proposed as `v3/worlds/<world>.json` style contracts + a `showcase_world_sheet` prompt, the frame as the portal, s03's through-frame push passing through them; RULED 2026-10-13: D78 worlds and guides (art world crayon / Clawd; programming world shaded futuristic / Codex; line world = every crossing; home = Seuss field; worlds are renderers over the one rig), D79 65 s eight beats six shots. Beat ledger `v3/beats-v2.json` (per beat: world, camera, actions, effects, transition in/out, tracked state flips with scope, references, asks) is the provisional story; spec v4-brief-22 Story v2. References: Tron: Uprising art-direction reel (Mielgo) and Boy and the World queued in the Eagle inbox; owner's Arcane and Spider-Verse folders to pick from. Open asks: what the human draws first (default the first stalk); how many gates light (default three). 2026-10-14: `showcase_world_sheet` created canonically (payload 35, call-owgfvF); crayon and shaded plates generated (receipts call-JtIpoH, call-0DTIFE; `v3/studies/world-sheets-01.md`, `assets/worlds/`): C1 holds on both, crayon field paper #f1dcbc stroked fills, shaded field #02050b stepped fills with emissive edges; contour on both the generator's 2 px (D76 pattern). World renderers + crossing operator being built by a worker (`src/library/worlds/`, `v3/worlds/*.json`, WorldSheet* and WorldCrossingProof compositions, `world-proof-01.md`). World renderers DONE 2026-10-14 (worker; `src/library/worlds/`, `v3/worlds/*.json` merged with plate measurements, `WorldSheet*` + `WorldCrossingProof`, `v3/studies/world-proof-01.md`; planner verified home = MeshProof 0.0 diff, ModelSheetHuman/LayoutSheetS02 byte-identical, Beat4 renders). Side-by-sides `v3/studies/world-compare-{crayon,shaded}.png`; renderer gaps listed in world-sheets-01.md addendum (crayon: directional sparse strokes + architecture; shaded: grid floor, rings, bloom, second step; line: inner contours on + boundary-loop metric). Owner judges the worlds from the side-by-sides. Next: renderer gap pass, then the itinerary in shots.json (world per shot, transitions) and the s02 keys. Next: `>>showcase_shot shot:"s02-cant-build-frame"` under the six-step chain (needs the `KeySheet` composition); dynamic poses are tested as s02's own keys at the layout camera (two in-plane moves + one drawn turn). Still open: the Eagle token; whether muse/tech_recommendation outputs end with an ``inspirations block (proposed, default yes); filing the unfiled clusters into Eagle (default no). Next: `>>showcase_model_sheet character:"human" pick:<human-gen-16 Swoop>` (needs `ModelSheet` composition), then `>>showcase_shot shot:"s02-cant-build-frame"` which needs `KeySheet` composition + a key-hold/inbetween primitive in motion.ts (library change the motion step will name). Next: the Cloak puppet, the s02 cloak→swoop transition, boil, then `>>showcase_shot shot:"s02-cant-build-frame"`. Human muse run 1 (SVG) DONE 2026-10-13 (chain-showcase_asset_muse#1; sheet 15 A Bell / B Kite / C Kin, receipt `v3/studies/human-sheet-15.md`, default pick B Kite) — awaiting the owner's pick. Then muse frame → gadget → companions (D63), fix the muse chain's empty `challenge` mapping, then `>>showcase_shot shot:"s02-cant-build-frame"`. Blender: deferred until a shot needs it (owner question 2026-10-13); the tool refuses cleanly without a binary. Board added 2026-10-12 (D56, references and laws only, nothing we drew): `media/showcase/v3/references/board.json` → `npm run board` → `board.html` + `board.png` (study board-01/02); 10 video references filed with provenance; muse sheets will cite board card ids. Style settled (owner, 2026-10-07): black field, five-role assets, Seuss architecture, Midnight Gospel stipple, radiance under assets, drawn on twos / light on ones.

- World gap pass DONE 2026-10-14: arch/gates/floor on the shared stage, crayon directional hatch, shaded grid+rings+bloom+two steps, line interior contours with the `loop` closure metric (`v3/studies/world-proof-01.md` addendum). Owner judges `world-compare-{crayon,shaded}.png`; open dials: shaded figure halo, crayon figure strength, stage pop-in at the line hold. Next: s02 keys at the layout camera, then the shots.json itinerary.
  Slice: script v1 written with the resource vocabulary; chain scaffolded canonically (story/treatment/motion/review rewritten to the substrate, `showcase-review` gate on the review step, Lane Conformance step). Studies 01–09 graded; rubric v1.2.
  Next: human sheet 14 WITHDRAWN (owner 2026-10-12, no pick; the human is re-mused from the board first); muse on the human, then the frame and the bubble, every variant citing board card ids; bubble-opening and frame assets per script; the three pass-08 fixes; then run the scaffolded chain once end to end on beat 4–5 as the trail (D49), receipting each stage.
  Constraint: proofs render on `swangle` here; final renders on the Windows host. Canonical mutations only through the isolated server with receipts.

## Intent

**Work type:** feature + exploration. **Confidence:** medium until render and MCP paths are driven.
**Scope:** creative resources, portfolio documents, isolated TypeScript media package.
The existing short terminal clips do not tell one coherent story. Create a silent motion piece
that introduces goals/features, then follows one workflow toward a tangible artifact. Its authored
workflow covers inspiration, script, color script, pacing, editing/transitions, motion design,
implementation and review. Narration is excluded by the owner's 2026-09-29 ruling.

This replaces the earlier clip-only direction. Existing GIFs remain existing assets; their original
MP4s are unavailable and do not establish fresh capture. The first draft is an editorial animation,
not recorded client footage. A real workflow smoke proves mappings, not full creative production.

## Rulings

- D55, owner, 2026-10-07: no first-iteration asset; a muse pass (`showcase_asset_muse` chain: design_muse → rendered AssetSheet → rubric) runs between iterations; rubric C19; beat1-11 human is the failing control.
- D54, owner, 2026-10-07: human skin = identity pigment between Clawd coral and Codex blue (tricolor), mauve-pink family; owner chose green `#67b479` with mauve `#c885c2` shadow step (`media/showcase/v3/studies/skin-10.md`).
- D53, owner, 2026-10-07: frame 0 is the poster and GitHub thumbnail: mark, trio, box, settled black field; the film never opens on overwhelm.
- D52, owner, 2026-10-07: visible line boil, Midnight Gospel wobble.
- D51, owner-confirmed 2026-10-07: animation language = drawn on twos, light on ones (creative-spec v4-brief-05 §Animation language); rubric C16–C18; `src/library/motion.ts` is the executable form; the early-web explainer tween is the failing control.
- D50, owner, 2026-10-07: world architecture = Dr. Seuss Midnight Paintings grammar; frame interior = receding turned frames; six references filed; colors/architecture provisional for the test demo, identity pigments fixed.
- D49, owner, 2026-10-07: inside the frame, organic but familiar architecture of the workflow; meta narrative = the bots standardizing their own design process; the server-scaffolded showcase chain is the trail viewers can run.
- D48, owner, 2026-10-07: glass pass accepted as the path; shadows evolve to Midnight Gospel dither/stipple gradients.
- D43 corrected 2026-10-07: "gospel" meant The Midnight Gospel's universe simulator, not Mind Game.
- Measured 2026-10-07: no GPU WebGL reachable from Remotion on this WSL2 box despite the paravirtualized 3090; `swangle` only; final renders on the Windows host or a GPU box.
- D47, owner, 2026-10-06: shadows are designed shapes (form shadow following the silhouette + cast shadow), as on the board; a flat band is not a shadow.
- D46, owner, 2026-10-06: the frame shows the entire environment (the assembled kit = gates, frameworks, prompts, resources), not one piece.
- D45, owner, 2026-10-06: beat4-still-01 rejected as a flat picture; the frame interior needs refraction and diffusion, so it becomes a GPU pass under `@remotion/three`.
- D44, owner, 2026-10-06: no calm daylight world. Saturated figures on a black field, readable as negative space; the owner's style board (`media/showcase/v3/references/style-board-2026-10-06.png`) is primary: five-role sticker assets, additive radiant animation style, maximalist painting as the overwhelm mood. Supersedes D39/D40 for palette and world.
- D43, owner, 2026-10-06: the gadget is a Mind Game-style hybrid machine, familiar parts in an impossible whole.
- D42, owner, 2026-10-06: the tool is a frame the companion holds up whose interior reads as nearly infinite.
- D41, owner, 2026-10-06: story is the box/gadget/overwhelm/frame/scaffold fable, not a feature demo; medium is Remotion with `@remotion/three` for the kit beat (tech_recommendation verdict KEEP, extended; Motion Canvas/Blender/hand-rolled capture avoided).

- D40, owner,2026-09-30: environment style must be organic and adapt to whatever the problem entails, with Animal Crossing-like swappable tiles/components and possible asymmetry. Retire fixed painterly forest as active world design; retain human/mascot/palette rulings. World comparison precedes dependent production.

- D39, owner,2026-09-30: selects A daylight base with B for focused moments. Preserve material/identity pigments; motivate focus through scene lighting/staging. Palette relationship is settled; actual relighting and motion quality still require proof.

- D38, owner, 2026-09-30: selects B figure with C layered shirt from comparison01. Decide palette; inspect/possibly borrow CloudySky color/lighting pipeline or quality baseline. Current source found at ~/Applications/cloudySky; read-only audit, no theme changes.

- D37, owner, 2026-09-30: outfit/hair lock, shared style/color script and a possible small animation test precede translating proved standards into reusable MCP prompts/gates. Consider the whole workflow and asset order; parallel delegation is explicitly within scope. Current phase plan records the dependency order and three disjoint discovery tasks.

- D36, owner, 2026-09-30: both Codex and Clawd accompany the human from the opening. They form the recurring core trio; additional specialists can join along the way. This supersedes choosing one provider companion as the sole recurring lead.

- D35, owner, 2026-09-30: confirms original blue terminal-faced Codex companion paired with Claude Code Clawd as identity anchors. Supplies exact Kevin Ngo, shfred, LCSlates and Chetas X demos plus Skillry Opus 5.5 gallery. These supersede searching for unspecified benchmark links; narrative roles and production method remain open.

- D34, owner, 2026-09-30: research better recent X/Twitter animation workflows; current companion
  reads as Pokemon instead of stylized Codex/Claude mascots, perhaps both. Human/world need cel
  shading and intentional line construction/weight, including shadow emphasis. Hair/clothes
  rework and palette remain incomplete. Integrate separate design-muse passes with script,
  color script and story in one workflow; concrete quality techniques become gates. Plan first,
  then interview/discuss and tackle parts sequentially. Prior production authorization does not
  authorize immediate new assets before this planning/discussion frontier.
  Phase working copy: plans/showcase-creative-rework.md; actual v1 delivery proof remains valid
  while its drawing/acting/mascot treatment is a failed control, not accepted production style.

- D1, owner: audience developers already using AI agents.
- D2, owner: silent motion/story replaces narrated product film.
- D3, owner: author the creative workflow in this server and use a creative team.
- D4, planner: retain approved mascot geometry; compare communication directions.
- D5, planner: Remotion is a reversible trial, not exclusive engine commitment.
- D6, planner: 75-second draft and short cutdown are pacing hypotheses for reaction.
- D7, planner: resources are authored through MCP; no parallel catalog/state machine.
- D8, planner: label illustrations; only real receipts support activity/verification claims.
- D9, owner: story follows a working environment scaffolded through agent interaction, with
  problems leading to authored/reused gates, checks and boundaries; frameworks supply common
  structure and the prompt travels the environment. Rollercoaster is an exploratory metaphor.
- D10, owner: stop production; preserve this as V1. The site was premature, design was generic,
  and one workbench should not define every stage. Interview together to establish the process.
- D11, owner: viewer is inside the environment, guiding the agent and co-building alongside it.
  Friendship and collaboration matter; move between real work and symbolic space to reveal the
  underlying process. Gate symbolism may be organic rather than roadblocks/construction zones.
- D12, owner: hybrid direction selected. Chicory supplies visible authorship/world interaction;
  Unravel supplies tactile rendering, material and character expression; Tiny Glade inspires the
  way structures, workflows and environments scaffold and appear. These references have distinct
  roles; specific tools and production techniques remain undecided.
- D13, owner: playful, creature-like world for building workflows and standardizing work with AI.
  Creature cast, viewer embodiment, framework/gate representations and real task remain open.
- D14, owner: one recurring creature companion; specialists join as work progresses. The ending
  can reveal a small ensemble, like residents gradually moving into an Animal Crossing town.
  This reference supplies social progression and belonging; the agreed visual/material references
  remain Chicory, Unravel and Tiny Glade. Production remains paused.
- D15, owner: the real task is building a small feature, with design inspiration, analysis,
  implementation and verification. The specific feature, target example/project, checks and
  observable before/after remain undecided. This is a story ruling, not a production restart.
- D16, owner: prefer a frontend feature whose visual design challenge is solved through the
  workflow and the user's standards. The earlier workflow-preview proposal was insufficiently
  concrete. Gate/framework symbolism, operator marks and a possible closing overview are open.
- D17, owner correction: focus on the video, the right assets and the workflow for producing
  animation/video. A literal frontend artifact is outside this focus unless useful for GitHub.
  Develop and scaffold the project's own workflow/gates as the creative work proceeds. D16's
  frontend interpretation and the proposed component demos are superseded. Full production remains
  paused while this process is discussed; do not infer a restart of the V1 build.
- D18, owner reference proposal: Adventure Time's world-feel, where a human interacts with and
  learns to understand an alien world. Relate this to working with AI and building workflows and
  environments to understand it. Treat world logic/relationships separately from the already
  chosen material/rendering references. Existing inhabited world vs authored/revealed world, and
  the companion's comfort with that world, remain open. Research only; production stays paused.
- D19, owner: the recurring companion is already comfortable in the alien world, like Jake,
  while there is still much to discover. Use ease, playfulness and capable assistance rather
  than omniscience. The human brings goals/standards; shared discoveries motivate authored
  workflows and checks. Human embodiment/camera and specific character design remain open.
- D20, owner: the human is cartoon/stylized to fit the world and visibly accompanies the creature.
  Audience are spectators watching an episode. Use an episodic cinematic viewpoint; the earlier
  first-person viewer/hands proposal is superseded. Silent format and real/symbolic transitions
  remain; character designs and acting language are still open. Production stays paused.
- D21, owner: lean into absurdism and contrast to express ambition, the breadth of tasks/workflows
  that can be standardized, and the user's exacting personal standards. Represent specificity and
  attention to detail through goals/criteria and character behavior. Deadpan versus escalating
  physical comedy, example tasks and first contrast beat remain open; no production restart.
- D22, owner: proceed with the first attempt. Reference research/design_muse and an at-a-glance
  carousel/moodboard are authorized; interview when important choices emerge from evidence.
  The accepted starting tone is deadpan absurdity with occasional physical comedy. V2 may produce
  a focused two-character/world study and short animatic using tools appropriate to each stage.
- D23, owner visual grade: human looks generic; animal/scene rendering is basic hyperrealism.
  Rebuild toward hand-drawn organic characters and soft textured environments, with contrast from
  visibly drawn-in gates, chains/paths and scaffolded buildings. The first three CGI frames are
  rejected look evidence; their pose animatic is held. This is a medium/design evolution, not a
  surface-filter tweak on the accepted character forms.
- D24, owner reference preference: 2000s Cartoon Network shows and experimental anime/animated
  films are strong anchors. Specific titles are requested; source studies can proceed meanwhile.
  No rigged/full-film production until the revised visual language is reviewed.
- D25, owner anchors: Adventure Time, Foster's Home, Ed Edd n Eddy, TRON Legacy, Alberto Mielgo-type
  painting, Mind Game and Spirited Away. Explicit exaggerated proportions, lanky silhouettes and
  oversized/draping clothes. Personal source archive found at /mnt/c/Users/legoj/Notes/Notion.
  Current drawn-film preference overrides older photoreal render recipes in that archive.
- D26, owner: the drawn approach is interesting but should be more organic/soft in tone; consider
  3D CG techniques with hand-drawn nodes for a middle-ground Nintendo-game-like demonstration.
  Stylized CG volume may support the illustrated result; earlier hyperreal/PBR look stays rejected.
  The initially open meaning of nodes is resolved by D27 below.
- D27, owner, 2026-09-30: derive the answer from the references: middle ground of Adventure Time
  into Ni no Kuni onto an Okami map, with styling used where relevant to explanation/communication.
  Ruling: expressive simple silhouettes and inhabited absurdism; soft painted spatial volume;
  selective authored ink paths, gates and transformations explain process. Shader/material nodes
  are an implementation option, not a required visible diagram or owner-selected renderer.
  Do not repeat the nodes interview. Proposed gate behavior remains a narrative metaphor until
  mapped to actual server evidence; no automatic world-building or validation guarantee follows.
  No cast is selected and no final renderer is committed. One same-sheet medium comparison and a
  bounded NPR-technique feasibility survey can proceed; rigged/long-film production remains held.
- D28, owner, 2026-09-30: the drawings themselves symbolize hand authorship; characters are not
  literally drawing the world. Ruling: authored feeling belongs to contours, materials, shapes,
  joins and construction motion. Natural inspection, arrangement, repair and scaffolding carry
  the action. Do not turn the Okami reference into a brush-power or diegetic drawing requirement.
- D29, owner, 2026-09-30: human proportions remain off, too rugged and closer to old Disney
  animation than Mind Game silhouette/stylization. Hybrid sheet is a rejected human-shape control.
  Proposed shape law: expression reads through uneven graphic proportions and a simple face
  before shading; falsifier is a weathered explorer face/coat/boots driving the character read.
  Research inspects existing sources; one original human-only sheet varies shape distribution.
  Clothing remains loose/draping without rugged gear. No cast selection, companion redesign,
  scene, rig or renderer commitment is implied. Source stills do not prove elastic motion.
- D30, owner, 2026-09-30: latest graphic human revision is much better; first and second shapes
  are good starting points. Likes wide/far-apart eyes, a big forehead, small nose, tiny full lips.
  Overall body should be smaller/compact, akin to Boondocks character proportions. Refine both
  accepted directions in one fresh comparison; preserve loose garments and intrinsic authored
  appearance. Boondocks grounds compact proportions, not source cast identity or exact ratios.
  No final cast selection, age prescription or companion/world production follows yet.
- D31, owner, 2026-09-30: inspect Riley as well as Huey in Boondocks. Compare source features
  before using the reference; source cast identity and costume remain reference boundaries.
  If a compact draft is already generating, preserve its actual inputs and do not claim Riley
  was incorporated retroactively. Facial requests and compact-figure objective remain active.
- D32, owner, 2026-09-30: second compact figure is better. Evolve the hair toward a cooler,
  rebellious/don't-care shape native to a world with varied cultures and ideas; contrast it with
  ordinary but sophisticated clothing through deliberate drape and overall silhouette. Design
  muse may refine this autonomously before continuing the first animation for the demonstration.
  Lighting and color are core production criteria. This authorizes a bounded first animation
  iteration and root selection among reversible hair/garment proposals; earlier study-only holds
  no longer block that slice. Full-film/website/publication/brand replacement remain outside it.
- D33, owner, 2026-09-30: lock a character iteration, then proceed to the first animation.
  Assets must be replaceable to reproduce the attempt, innovate on artwork and swap scene items.
  Root may lock one bounded candidate after review. Scene choreography, asset slots/anchors,
  and light/color/timing data must be separate. Actual reusable source and a rendered first clip
  are required; a contact sheet or proposed toolchain alone does not complete this slice.

## Personal source grounding for the drawn revision

Read-only source notes (not edited or globally promoted):

- Art/Foundation/Personal Art Style and Inspiration.md: expressive lines; big hands/feet;
  slouched lanky arms; Adventure Time's legible communities; muted color/deeper darks; patchwork,
  drop shoulders and loose/draping cloth; subtle reactions and audience discovery.
- Art/Character Design/Ideas/Silhouin Character Design Bible.md: transferable broad flowing coat
  against tapered legs, angular silhouette and delayed drapery motion. Its specific masked/combat
  character and photoreal foundation are not adopted for this film.
- Art/Case Studies/Alberto Mielgo.md and its inspected saved images: painted color/light planes,
  sparse expressive hatching, selective sharp graphic accents; no exact artist/character copying.
- Cinematography/Case Studies & Artists/Movies/Tron Legacy.md: purposeful leading lines and scale
  contrast. Apply to authored paths/scaffolds rather than imposing a neon rendering treatment.
- knowledge-hub/practice/records/profiles/art-direction-profile-v2.md is explicitly draft:
  supports editable, authored comparisons and medium-specific evidence, not a binding style.

Current medium law: soft painted 3D world volume supports graphic authored cast and structures;
hair's loose unequal contour contrasts with ordinary clothing's organized drape. Intrinsic drawn
character is not a literal drawing mechanic. Preserve rejected CGI as break-control evidence.

## V2 bounded production slice

| Row | Owner / tier / effort            | Owned artifacts and failure shape                                                                                                                           | Depends       | Verification                                                                                                                 | State |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----- |
| 2.1 | Reference producer / high / high | Source-led hair/drape treatment,12 contiguous acting beats,3 color/light beats and replaceable slots; wrong source or story transfer                        | —             | Sources inspected; episode-study.md and viewer/provenance checks                                                             | done  |
| 2.2 | Art director / high / high       | One3-candidate hair comparison then one transparent4x3/12-cell original character kit; wrong identity/registration/alpha                                    | 2.1           | Root hair lock; exact output/alpha/bounds/hash/part receipts; actual kit inspected                                           | done  |
| 2.3 | Production / high / high         | Isolated Three.js hybrid scene/capture package, named asset/pivot manifest,15s/360frame/24fps export and one item-swap proof; wrong approach/contact/export | 2.1, 2.2      | Actual native WebGL2 render;2-frame orientation/color/decode probe; full encode/ffprobe/playback; swap without timeline diff | done  |
| 2.4 | Planner                          | Source-grounded lock, native browser/capture, visual review and integration                                                                                 | 2.1, 2.2, 2.3 | Compare actual frames/action/light/color to owner rulings; honest technique/source/reproduction report                       | done  |

Image generation makes concept and transparent part assets; a client-owned manifest registers
UV bounds/pivots/anchors. Three.js0.186.1 is a reversible trial for actual3D world/props and
articulated2.5D cutouts; native T3 browser renders/uploads deterministic frames and FFmpeg encodes.
This is not a full3D character rig or simulated cloth. Lighting/color/timing and choreography stay
separate from replaceable art. V1 remains preserved. No global installation or full-film tool lock.

First study's contrast hypothesis: an earnest human attends to one tiny authored detail while a
comfortable creature companion casually supports an absurdly ambitious construction. Only the two
leads appear initially. The world is already alive, with a locally authored working place. Character
design/materials/colors are candidate choices for review, not replacements of the canonical logo.

Artifact review criteria derive from settled rulings: both leads visible and stylized; tactile
material language; comfortable but curious companion; readable human intent; coherent local
construction; deadpan scale contrast; no fabricated real-run verification badges. Executable
checks cover actual files/formats/durations, separately from visual judgments.

## Later creative frontier

- First production example is now authorized: a tangible crossing-fit standard, human correction,
  companion help and continuation in one short scene. Earlier image-comparison/command-palette
  proposals remain outside scope. Full feature overview and episode expansion come later.
- Symbolic vocabulary: proposed framework pattern book, gates as inspection practices/artifacts,
  chains as context-carrying paths, and sparse exact operator marks on related objects. These are
  discussion candidates, not adopted mechanisms or new server behavior.
- Teaching: proposed meaning-through-action during the story, followed by a short closing map
  linking familiar objects/actions to the real server terms. Close through storyboard discussion.
- Standards now govern the concrete first animation and asset-swap checks. Visual review remains
  separate from executable artifact checks; no extra interview/approval stop blocks this slice.

## Existing systems audit

| Existing                         | Reuse                                                                    |
| -------------------------------- | ------------------------------------------------------------------------ |
| README + charter                 | Portable workflow positioning, direct voice, client execution boundary   |
| assets/brand                     | Intact mascot, optical masters, Ink/Paper/Route/Gate palette             |
| design_muse                      | Reference sourcing, capability envelope, direction comparison            |
| tech_recommendation              | Baseline-based renderer survey                                           |
| strategic_worker                 | Client-native bounded production handoff                                 |
| resource_manager / prompt_engine | Validation/write receipts, sequencing and context mappings               |
| Previous export work             | Native readable text; trim waits; hold results; small README derivatives |

## Consequences and boundaries

The scene manifest is a client production artifact: story author writes, renderer reads,
composition projects. It adds no server runtime schema semantics. Chain mappings publish whole
step outputs using existing behavior; the client dispatches specialists and runs rendering.
Model review criteria and executable verification stay distinct. Compatibility does not prove
both Claude and Codex were tested.

Use the linked worktree bootstrapped from local HEAD. Main has unrelated work, left untouched.
Media dependencies get their own package/node_modules; root/server dependencies are shared symlinks.

## Implementation slice

| Row | Owner / tier / effort  | Responsibility and failure shape                                                              | Depends       | Verification                                                               | State |
| --- | ---------------------- | --------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------- | ----- |
| 1.1 | Story / high / high    | Script + earlier eight-scene manifest, latest environment outline; wrong story                | —             | Parsed/timed manifest, formatter/links, claim audit                        | done  |
| 1.2 | Brand / high / high    | Remotion package, three-world board, 20s proof/stills; wrong visual/engine approach           | 1.1           | Typecheck, actual export/ffprobe, shared-browser playback/layout           | done  |
| 1.3 | Workflow / high / high | Four specialist templates + parent chain via MCP, SDK client/receipts/runbook; broken mapping | —             | Isolated seven-step smoke; active install and launch/handoff compatibility | done  |
| 1.4 | Planner                | Reconcile private drafts, preserve open metaphor decision                                     | 1.1, 1.2, 1.3 | Claims audited, board/video driven, receipts linked                        | done  |

New documents keep production detail out of the acquisition README. A dedicated media package
keeps rendering dependencies out of the server. New templates cover missing creative contracts;
existing resources retain inspiration, technique choice and client execution ownership.

## Completion criteria for draft slice

1. Silent environment-story outline presents purpose/features, then work that authors reusable
   structure; the earlier self-showcase storyboard remains a labeled renderer proof.
2. Color/pacing/edit/motion decisions are explicit, editable and provisional.
3. Reusable workflow is created through MCP and inspected/run with correct mappings.
4. Actual programmatic animation exports/plays; evidence status is visible.
5. Three distinct directions offer comparison while retaining canonical logo.
6. Public README/brand replacement waits for an accepted concrete draft.

## Sources and inspiration

- README.md; docs/portfolio/readme-charter.md; assets/brand/README.md and canonical social preview.
- Canonical design_muse chain-design_muse#2 and tech_recommendation chain-tech_recommendation#1.
- https://www.remotion.dev/docs/ — frame-driven React/TypeScript and export.
- https://github.com/remotion-dev/remotion/blob/main/LICENSE.md — license/trial eligibility.
- https://motioncanvas.io/docs/ — generator-based vector alternative.
- https://slama.dev/motion-canvas/introduction/ — practitioner workflow comparison; provenance dated.
- https://github.com/heygen-com/hyperframes — HTML/GSAP alternative, not yet locally probed.

## Open production decisions

Direction/duration remain provisional. Default: Workflow Instrument, 75s. Flip through board/film
reaction if Atlas explains client/workflow relations better or reading requires more time.
Music is optional; draft works in silence and excludes unlicensed audio.
Trace-based film scenes close when calls/actor handoffs support exact claims; a smoke is insufficient.
Latest story direction is exploratory. Compare a route through an evolving landscape, an authored
workshop/city, and a transit/track system before selecting a mechanism. Do not convert framework
guidance into an implied guarantee of physical-law enforcement. Each structure in the symbolic
world must correspond to an explicit client/resource-author action or a retained authored resource.

## Context

Renderer baseline: raw terminal capture and older GIF derivatives, with no editable film timeline.
Keeping that baseline would leave typography, staging and exact timing bound to live capture.
Hand-writing a browser-to-video exporter would add an encoding/capture responsibility unrelated to
the creative work. No engine performance benchmark was run during the choice.

## Analysis

| Candidate       | Fit and documented tradeoff                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Remotion        | React/TypeScript compositions, SVG/HTML layout and exact frame evaluation; browser-based rendering and its own license                 |
| Motion Canvas   | Generator-driven vector choreography/editor; a different animation model and exporter setup                                            |
| Hyperframes     | HTML/GSAP agent-facing video production; promising alternative, unprobed locally in this slice                                         |
| Manim           | Python alternative for authored explanatory animation; no local prototype or current API verification, so no comparative quality claim |
| Browser capture | Existing baseline can prove real interactions; less suitable as sole source for editable editorial scenes                              |

Practitioner sources and transfers:

- https://prismic.io/blog/create-videos-with-code-remotion-tutorial — data-fed React composition
  turns a stable template into repeatable videos. Borrow artifact-driven scenes; its older setup
  prerequisites are not treated as current API guidance.
- https://slama.dev/motion-canvas/introduction/ — property-level choreography and live visual
  iteration. Borrow separate transforms/opacity and parent-relative relationships, not its exact API.
- https://github.com/iart-ai/motion-skills — authoring plus render/frame-inspection loops. Borrow
  the delivery/review pattern; do not import its catalog or create a second workflow authority.

Current Remotion API was retrieved through Context7: registerRoot, Composition, Sequence,
useCurrentFrame, interpolate and spring. Animation must use frame state rather than CSS clocks.
License source permits individual and evaluation use; do not assume blanket MIT licensing.

## Goals

Trial one 2250-frame, 30-fps silent composition with editable text/timing; export a playable MP4 and
inspect representative frames. Keep production dependencies outside server runtime. Direction
comparisons must hold content constant and remain provisional until the owner reacts.

## Execution

**Verdict: TRIAL Remotion. Confidence: medium before export, bounded to this typography/SVG draft.**

1. Create the isolated media/showcase package with exact installed versions and its own lockfile.
2. Register the manifest-driven composition; derive every animation from frame number.
3. Typecheck, render the full draft and stills, inspect playback, and measure the MP4 with ffprobe.

```tsx
const opacity = interpolate(useCurrentFrame(), [0, 12], [0, 1], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
});
// Used inside the worker's registered, manifest-driven React composition.
```

The worker package records actual commands; typical CLI shape verified in retrieved docs:

```bash
npx remotion render src/index.ts Showcase out/showcase-draft.mp4
```

After D9, full export of that earlier story is held. Only the reusable opening is exported as a
short renderer proof; the environment story remains a conceptual comparison until discussion.

## Evaluation

Success is measured by completed export, correct dimensions/duration/fps, inspected frames and
seekable edits. These do not establish audience effectiveness or production-engine superiority.
An unreadable scene, unavailable renderer, or disproportionate iteration cost can reverse the trial.

## Refinement

Adjust the scene manifest and choreography after reviewing the draft. If vector relationships
dominate the accepted story, compare a small Motion Canvas/Canvas Commons prototype; if reuse of
HTML/GSAP compositions dominates, compare Hyperframes. Verify those current APIs before adoption.

## Environment-story experiment (design_muse)

**Frame:** show practice becoming a reusable environment through deliberate client authorship.
The viewer should connect a noticed problem, the resource created in response and a later reuse.

Goal-relative sources: the owner's environment/travel sketch supplies the story; the README
supplies the client/workflow relationship; the gates guide distinguishes review criteria from
executable checks; the frameworks guide supplies reasoning structure; the canonical social
preview supplies a route/checkpoint motif. Literal rollercoaster is the boundary reference:
passive riders and uninterrupted speed can obscure authorship and inspection.

**Capability contract:** we own symbolic composition, spatial sequencing, captions and camera
movement. Client tools author resources and perform work. The server resolves resources, carries
step context and handles gate state. Framework scaffolding represents common reasoning guidance,
not deterministic physics; resource retention represents authorship, not automatic learning.

**Distinct directions:** route landscape makes revisiting equipped terrain visible; workshop city
makes work sites and specialist contributions tangible; transit makes selected step order explicit
but risks implying passive clients and fixed routes. Preserve mascot geometry in all three.

**Pairwise critique:** landscape favors accumulated practice; workshop favors making; transit favors
sequencing. Landscape/workshop are leading hypotheses rather than final identity rulings.

**Controlled evidence:** one HTML board, same task/problem/authored checkpoint/returning packet,
same palette/content/frame. Vary spatial organization only. Inspect large and 720px-wide views;
check whether a viewer can point to who authored the checkpoint and what changes on the next task.
Reverse the landscape hypothesis if workshop communicates those causes more clearly.

**Synthesis:** the weakest point is that terrain may feel abstract; workshop buys concrete acts at
the cost of more objects. The smallest next move is this comparison and a discussion, not a full
new world renderer. Counter-vector: the traveler may be context rather than the engine or mascot.

**Capture:** none; goal-local draft evidence, no durable taste profile or published brand change.
Discussion forks: landscape/workshop, framework scaffolding/architectural grammar, visible actor/
moving context packet. The owner's request permits discussing these later; no choice is assumed.

## Derivative exports after acceptance

Full 16:9 film with poster and scene copy; 20–30s cutdown; concise README loop/poster + watch link.
Hold commands/check results at readable scale. WebP can serve short inline clips with a static
alternative; derive from new MP4, not old GIFs. README edits retain charter budgets and replace
competing headers.
