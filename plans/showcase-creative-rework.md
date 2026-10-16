---
title: Showcase creative rework and production workflow
date: 2026-09-30
status: active
type: plan
parent_plan: demo-video-plan.md
initiative_branch: docs/creative-showcase
worker_cap: 3
planner_session: showcase-creative-rework
---

# Showcase creative rework

## Now (2026-10-06)

Goal: unchanged intent, new law: saturated five-role flat assets plus an additive radiance layer on a black field (D44), Remotion substrate with the Three.js kit beat inside it (D41).
Slice: v4-brief-01 style bible replaces the v3 briefs (frozen as controls); board filed with receipt; Tier 2 rows 2.4–2.6 and Tier 3 row 3.1 are answered by the spec and the tech pass and close when the beat 4 still is reviewed.
Next: token file and radiance component, one role-filled sprite, beat 4 still, then the beats 4–5 proof. Rows 1.x and 2.1–2.3 are satisfied by D35–D44 and the frozen human.
Constraint: no regeneration of the human; no new world boards; proposed gates stay uninstalled until the moving proof exists.

## Intent and the decisions most likely to change

**Work type:** feature + design evolution. **Confidence:** medium; the quality target is clearer, while the narrative and production method remain open.
**Scope:** this phase plan, reference research receipts and the master plan's current state. Future work extends client-owned creative artifacts and canonical MCP resources.
**Problem:** a reproducible film used unrelated or weakly constructed assets and a rendering lane that could not produce the requested drawing behavior. Establish story, color, identity and construction together before selecting production methods.

- Reopen the production lane. Three.js/cutouts are a tested baseline, not the next default.
- Replace the generic creature with the owner-confirmed original blue terminal-faced Codex companion and Claude Code Clawd. Preserve recognizable face, silhouette, appendage and palette cues through the shared stylization. Do not invent a species or infer that the providers should compete.
- Rework the human's actual garment cut, shoulder/sleeve/cuff/hem construction, hair masses and pose silhouette. Retain the accepted compact figure and wide-set eyes, large forehead, small nose and tiny full lips as starting invariants.
- Reopen pigment and value roles. The human's coral top can conflict with Clawd's coral identity; the palette pass must resolve focal separation.
- Treat cel values, form-aware line hierarchy and convincing gesture as upstream acceptance criteria. Encoding, anchor coincidence and a painted texture cannot approve those qualities.

This is a plan for discussion and subsequent execution. The previous clip and sources remain unchanged as a rejected look/motion control. No website, global taste-profile update, provider rivalry, final logo replacement or public release is included.

## Existing systems and evidence

| Existing surface                                                               | Reuse or change                                                                                                                                                                    |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `showcase_pipeline` v2                                                         | Extend its reference → story → treatment → motion → technique → production → review spine. One early muse is insufficient; insert focused passes and shared-spec handoffs.         |
| `design_muse`, `showcase_story/treatment/motion/review`, `tech_recommendation` | Reuse canonical prompts by explicit subject/context. Do not build another catalog or copy native prompt bodies.                                                                    |
| `showcase_asset_study` v5 and `showcase-asset-continuity`                      | Reuse stage/authorization/provenance review. It is an advisory reminder, not an executable artistic-quality threshold.                                                             |
| `episode/assets.json`, clock, contact/capture/encode/swap harness              | Reuse semantic slots, registration discipline and deterministic evidence where the selected lane supports them. Re-register new artwork; old pixels and pivots are not invariants. |
| Current atlas, continuous Lambert world and unlit cutout acting                | Preserve as failed controls; they are not approved production assets or an approved shading/rig method.                                                                            |
| Existing story/color documents and references                                  | Retain accepted intent and source roles. The bridge story, pastel treatment and current animation length remain hypotheses, not binding next-film choices.                         |

Verified document integration points: [workflow consumers/contracts/reviews](../docs/portfolio/showcase-workflow.md), [prior treatment](../media/showcase/v2/episode-study.md), [rebuild and replacement boundary](../media/showcase/v2/episode/README.md).

Research receipts:

- [Skillry mixed-pipeline leads](research/showcase-skillry-workflow-leads.md): creator-stated staging/editing, code, generated imagery/animation and audio methods; original/remake distinction and source-proof limits.
- [Exact Kevin Ngo and shfred references](research/showcase-x-demos.md): downloaded original media and sampled full-frame images support paper/material coherence and narrative/ink composition respectively. Primary captions corroborate their stated methods; generated implementation source remains unverified. Earlier January/February process research is preserved as history.
- [User-supplied LCSlates and Chetas sources](research/showcase-user-reference-workflows.md): primary text, original media and untouched analysis frames. LCSlates informs coherent material transformation and iterative preview; Chetas informs gaze, expression and differentiated personalities. Neither establishes full-body garment acting or shadow-weighted cel outlines.
- [Official mascot identities and missing human redesign](research/showcase-mascot-identity.md): original [Codex companion](https://persistent.oaistatic.com/codex/pets/v1/codex-spritesheet-v4.webp), official catalog at pinned commit, and official [Clawd demo](https://raw.githubusercontent.com/anthropics/claude-code/732e167ee9d71296b4b63d6f529ac1334513826a/demo.gif) with current changelog distinctions.
- [Render gaps and proposed gates](research/showcase-render-gaps.md): actual source, atlas and frames0/144/276. Continuous world shading, unlit painted actors, repeated garment masses and uniform route geometry explain the current failure.

## Current production order and parallel slice

D40, owner,2026-09-30: current style does not communicate an organic environment that can fit/mold into any problem; use Animal Crossing-like swappable components/tiles as adaptability reference, perhaps asymmetric. This evolves the world grammar, not the accepted character/palette choice. Current spec v3-brief-04 preserves prior03 input.

D39, owner,2026-09-30: selects A daylight base with B focused moments from actual palette-light-01. This settles the color relationship without approving the board's modest character relighting or final world design.

D38, owner, 2026-09-30: selects B with C shirt; decide the palette and inspect/possibly borrow CloudySky's color/lighting pipeline or at least its quality baseline. Actual repo found at `/home/minipuft/Applications/cloudySky`. Freeze current brief at v3-brief-02 and preserve the original v3-brief-01 bytes for prior evidence.

D37, owner, 2026-09-30: prioritize locking outfit and hair, establishing style and color script, considering a small animation test, and translating demonstrated standards into reusable prompts/gates so users can understand and repeat the process. Explicitly authorizes considering parallel delegation. The current slice establishes concrete briefs and dependencies; it does not pretend unseen candidates are locked.

**Compound diagnosis:** isolated asset passes + late artistic review produced a reproducible clip whose construction and drawing missed the brief. The remedy is a shared creative revision, early integrated proofs, and corrections returning to the stage that owns the failure.

| Stage                                            | Prompt reuse / planned extension                                                 | Output and dependency                                                                                                                                                                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Carry settled intent into a small scene brief | `showcase_story` + current rulings                                               | Human/Codex/Clawd together from opening, silent spectator episode, creative production as the task. Minimal action/staging and reference roles guide design; do not reopen the whole interview.                                                             |
| 1. Parallel reference and design briefs          | Focused `design_muse` calls                                                      | Human cut/hair masses; companion identity/world drawing; provisional light/value/palette relationships; workflow contract can be assessed independently. All consume one brief and existing reference receipts.                                             |
| 2. Human comparison and selection                | `showcase_asset_study` in human correction scope                                 | Whole garment construction + hair masses, then controlled hair refinements with chosen garment. Keep face, pose, camera and light consistent to judge the changed property. Select actual visible construction; prose recommendations do not lock an asset. |
| 3. Integrated trio/world style key               | `showcase_asset_study` + `showcase_treatment`                                    | Chosen human with official Codex/Clawd, one small environment patch; value planes, edge hierarchy, substrate and light agree. Companion/world research can precede the human lock; final posed assets consume it.                                           |
| 4. Script/storyboard and final color script      | `showcase_story` + `showcase_treatment`, fed by the same creative revision       | Shot purpose, acting, transitions, light sources, palette/value roles and color progression are co-developed. Rough color intentions start in stage1; final beat-addressed keys require stages2–3.                                                          |
| 5. Motion and technique proof brief              | `showcase_motion` + `tech_recommendation`                                        | A representative turn→reach→contact→response→settle action, cloth/hair, both mascots and one world-scaffolding beat. Compare production lanes against this proof; use tools per stage.                                                                      |
| 6. Build and review a short actual motion test   | Bounded `strategic_worker` ownership + `showcase_review`                         | First proposed duration6–10s, adjusted to readable acting rather than an artistic threshold. Hold, reach/contact and consecutive-frame review; replace an object or garment slot and repeat. No full film before these failure modes are resolved.          |
| 7. Standardize the successful method             | `create_prompt` / `create_gate` → MCP validate/preview/update existing resources | Encode the observed criteria, evidence contracts, local gates and correction routing. Existing stage prompts/pipeline are extended; reusable workflow reads a project spec instead of hardcoding this cast or palette.                                      |
| 8. Exercise, then expand                         | `showcase_pipeline` + actual reviewed stage results                              | Positive/negative gate controls, revision/mapping checks and reproduction documentation precede a larger cut. Symbolic agent activity remains distinct from captured real MCP interaction.                                                                  |

The current seven-step `showcase_pipeline` v2 is sequential and does not yet encode this expanded ordering or these proposed quality gates. It is not presented as the new workflow already implemented. A later canonical update is made through MCP tools only.

### User-facing reproduction record

The later walkthrough follows actual work rather than a fictional server trace: for each stage retain the canonical prompt/version and inputs, shared spec revision, reference pointers, client/subagent responsibility, resulting source/artifact, observed review or executable result, correction and resumed stage. Include at least one genuinely rejected comparison and the revised proof, then a declared asset replacement and rebuild. This makes standards understandable and repeatable without claiming the server draws, animates or judges images itself. Record current discovery invocations and C4 generation separately from future motion/resource-validation runs.

### Asset-building order

1. Controlled human outfit/hair comparison; preserve accepted face/body intent, rework failed construction.
2. Selected human turn/pose/contact drawings or forms, with garment and hair components addressable for replacement.
3. Codex/Clawd posed treatments in that same line/value language; official identity cues remain recognizable.
4. One representative world patch and replaceable interaction object, not a full environment kit.
5. Integrated color/light keys and storyboard, then only assets needed by the short test.
6. Technique-specific rig/layers/materials, motion and export; broaden the kit after visual proof.

**Separate contracts:** identity/source asset slots; garment/hair/prop registration; camera/acting/timing; lighting; color keys; line/substrate rules; actual render commands. Replacement declares which contracts remain invariant and which require redraw/re-registration. A new source image is not assumed to preserve old pivots.

### Current parallel dispatch

| Row | Owner / exact file                                                                        | Bound                                                                            | Tier / effort / failure shape                                                               | Verify                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| C1  | story → `research/showcase-human-construction-pass.md`                                    | 2–3 construction directions + one comparison brief                               | worker-high / high (role-bound effort) / repeating rejected silhouette under new styling    | Canonical muse used; actual prior sheets inspected; garment/hair and contact failure checks explicit                               |
| C2  | demo → `research/showcase-style-color-pass.md`                                            | One proposed drawing law,2–3 color/light relationships and one motion-test brief | worker-high / high (role-bound effort) / disconnected palette, texture and story            | Reference properties and uncertainties visible; final-color dependencies and light/line checks explicit                            |
| C3  | workflow_contract → `research/showcase-prompt-gate-contract.md`                           | Existing resource map, review contract and3 example criteria                     | worker-high / high (role-bound effort) / nonexistent enforcement or duplicate orchestration | Current MCP schemas/gate boundaries inspected; no invented parameters or auto-art verdicts                                         |
| C4  | story → `../media/showcase/v3/studies/human-outfit-hair-01.png` + companion `.md` receipt | One unmodified generated3-direction comparison sheet, actual opened review       | worker-high / high / another haircut sheet repeating failed garment construction            | Accepted face/body intent preserved; actual outfit cuts/hair masses compared under shared light/value, no pose-sheet motion claims |

Workers are in the existing shared creative worktree, own disjoint files and move no git refs. Root accepts C2/C3 as planning proposals, not artwork approval; C1 provides the construction comparison. C4 below is a separate bounded asset task after discovery synthesis. No renderer/resource write is authorized in this slice.

### Accepted discovery synthesis; visible evidence pending

- C1 recommends an offset-panel pullover with a defined shoulder/armhole, controllable forearm, layered diagonal hem and broad uneven swept hair crest; compare a longer raglan shirt and short sleeveless outer layer. Preserve roomy hanging drape while clarifying shoulder/cuff/contact; no unchanged balloon top. Outfit/hair are not visually locked yet.
- C2 proposes: **each mark explains silhouette, overlap, material or intent; light organizes forms into designed value planes while texture stays subordinate.** Soft open daylight is the first comparison baseline; overcast ink-field is the bounded alternative if figure/ground collapses. Shadow/contact weight is selective, not applied to every dark edge. Final pigment/value roles wait for integrated cast review.
- C3 confirms existing resources cover the responsibilities. Current continuity guidance is advisory; review/judge mode does not inspect images autonomously. Runtime progression can enforce a submitted verdict or executable result, not authenticate artistic truth. Parallel production is client delegation, not a promise made by graph edges or maxFanOut.
- Canonical `design_muse` guidance runs #2 and #3 are retained/cancelled without artistic PASS. C4 uses image generation as a comparison prototype; no rig, temporal continuity, seed-controlled reproduction or final art acceptance follows from its output. Its asset-study guidance run #1 was also cancelled cleanly after the client produced and reviewed the sheet. C1–C4 handoffs are complete.

Discovery receipts: [human construction](research/showcase-human-construction-pass.md), [style/color](research/showcase-style-color-pass.md), [prompt/gate contract](research/showcase-prompt-gate-contract.md). C1/C2/C3 receipts are present and accepted as discovery proposals. C4 sheet is present and opened; its complete prompt/provenance receipt accompanies the artifact. It is a construction comparison, not motion proof.

### First actual visual review

[Human comparison sheet](../media/showcase/v3/studies/human-outfit-hair-01.png), generated once and opened by root. A has a short crossed/layered hem and cropped lower volume; B has a long vented shirt; C has a sleeveless outer layer. These are visibly different garment constructions, and the simple compact face intent persists. Root's proposed next combination is **A garment + B swept hair**, subject to the focused choice presented with the actual sheet.

**Review result:** useful comparison accepted; final construction/drawing/motion remain unresolved. Shoulder seams are still similar in A/B, intended cuff/torso clearances need selected-pose proof, and the contact insets show resting palms rather than a demonstrated grasp. Contours remain mostly fine with limited weight hierarchy; this is not approved final cel/ink treatment. Clothing values and lower trouser shapes also vary, so this generated sheet is a broad direction comparison rather than a rigorously one-variable test. No seed-controlled generation, rig or independent acting is claimed.

Return corrections to the selected garment/hair pose study and shared line/value key before animation. Do not hide them with texture or export success. Evidence: [exact generation receipt](../media/showcase/v3/studies/human-outfit-hair-01.md). This is a real project review that the later walkthrough can explain; no runtime gate verdict was submitted for it.

### Current B/C and color-transfer slice

| Row | Ownership / output                                                   | Bound and dependency                                                                          | Tier / effort / failure shape                                                                  | Verification                                                                                                                        |
| --- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| C5  | story → `../media/showcase/v3/studies/human-selected-02.png` + `.md` | One B figure/C layered-shirt refinement; rest + actual grasp, neutral placeholder colors; D38 | worker-high / high / drifting selected identity or disguising weak sleeve/contact construction | Actual selected source inspected; generated result opened, provenance and visible limitations recorded                              |
| C6  | demo → `research/showcase-cloudysky-color-transfer.md`               | One source-grounded muse;2–3 distinct palette/light relationships; D38 + read-only audit      | worker-high / high / imposing a dark UI grammar or inventing computation/live proof            | Transfer boundaries and pigment/light roles explicit; actual source paths and display scope preserved                               |
| A1  | cloudy_color_audit, read-only source                                 | Targeted Source→master→composition→output and test/proof trace; complete                      | explorer / inherited effort / wrong source ownership or stale diagnostic                       | Current symbols and boundaries reported; no live behavior/test-run claim                                                            |
| C7  | demo → `../media/showcase/v3/studies/palette-light-01.png` + `.md`   | One same-cast/scene3-direction comparison; C5 + C6 + A1 accepted                              | worker-high / high / palette drift hiding construction changes                                 | Same selected shirt/hair and mascot identities; color/light differences visible, actual generation versus computation distinguished |

**Source audit accepted as current-source evidence, not live CloudySky validation.** Implemented path: PaletteExtractor → PaletteCoordinator.assemble → buildColorMaster → target projection → linear field composition → shared picture formation → encoding. ColorMaster has unbounded chroma with L within[0,1]; shader composition creates radiance. Current runtime tone.highlightOp default is1/PBRNeutral despite older AgX comments. The main-thread gradientInputs diagnostic is explicitly stale initialization data in tools/cdp/color.mjs; do not use it as frame-authoritative proof.

Animation transfer contracts:

1. Approved identity/material pigments remain separate from shot key/fill/exposure. Neutral-light and story-light captures expose identity loss.
2. Retain scene values until the declared output transform; compare saturated/overflow controls and actual final encoded frames. No early per-channel clamp masquerading as source fidelity.
3. Each light names origin, receiver and intended consequence. Light-off/direction controls isolate face planes, cloth/contact and world shadow response.
4. Perceptual authored palette travel and linear illumination accumulation have distinct owners. Neutral/chromatic, midpoint and settle controls detect hue detours, grey dips or pops.
5. Demonstrate rendered consequences before encoding standards. Use cast-only/world-only/integrated, grayscale, keyed poses and motion; source/tests alone do not approve the art.

The dark additive watercolor/glass medium, Spotify bridge/DOM timing, audio hierarchy, mono-album rescue and numeric APCA/UI/GPU/dark-field defaults do not become animation requirements. Pipeline/module reuse remains a technique decision after the cel-animation lane is chosen; this slice borrows the grounded ownership/proof baseline and compares actual art-directed palette/light keys. Generated color keys are not advertised as evaluated CloudySky math.

C5 opened review: [selected human](../media/showcase/v3/studies/human-selected-02.png) preserves B swept hair/compact figure and C layered shirt. Thumb/fingers now oppose around the object; it improves on the resting-palm control. Mostly fine contours and modest cloth tension changes remain unresolved; source/detail continuity and motion are not proven. Accepted as selected construction input for color study, not final cel/ink or animation approval.

C6 [palette proposal](research/showcase-cloudysky-color-transfer.md) defines A cloudlit grove (sage/cream, warm key/cool fill, taupe layers), B warm threshold (mauve/blue-grey shade, moss outer layer, motivated warm opening), C overcast ink field (bone/grey-green, plum-grey layer, charcoal/violet structure). C7 compares the same selected cast and small world arrangement. These are art-directed color/light hypotheses informed by verified source contracts; no CloudySky math, exact extraction, calibration or live source-rendering is claimed. Palette selection remains open until the actual board is viewed.

### Actual integrated palette review

[Palette/light board01](../media/showcase/v3/studies/palette-light-01.png) opened by root. Same selected B/C human holds the same object beside recognizable Codex and Clawd in all three panels. A has sunny sage/cream space, B warm late-day key against mauve/cool shade, C a quieter grey-green/plum overcast field. Root recommends A as the everyday base, with B's relationship for focused moments; the owner's palette choice is pending.

**Accept as a color/light relationship comparison only.** The image does not execute CloudySky math or prove exact grading, material relighting, target encoding, rigs or motion. B is an open late-day clearing rather than the proposed clear enclosed threshold. The environment has richer natural detail than the minimal world patch requested; it is not a final alien-world/scaffolding design. Human face/cloth relighting is modest, contours are mostly quiet, and cast construction/line treatment needs an integrated cel-light proof. Palette direction does not override those unresolved properties.

C5/C6/C7 handoffs complete; guidance runtimes closed without artistic PASS. C7 receipt: [exact inputs/tool/prompt/provenance](../media/showcase/v3/studies/palette-light-01.md). CloudySky source hashes: [read-only snapshot](research/showcase-cloudysky-source-receipt.json). These records distinguish art-directed generated keys, source-inspected contracts and later executable renderer proof.

### World grammar evolution slice

Diagnosis: fixed scenic composition answers "where are they?" but not "how can this place be reconfigured for the work?" Dense rocks/leaves/trees are **superseded** as the active world direction; keep the old palette board as evidence/control, not a production option. No source world-kit implementation exists in v3, so retirement is a design-assumption change rather than a fake code deletion.

Proposed law/falsifier lives in creative-spec04. It serves reusable/task-shaped environment construction and risks unreadable seams or a rigid jigsaw/grid aesthetic. Research must distinguish visible modularity from unverified game internals; no invented Animal Crossing generation algorithm or required WFC/grid is inferred.

| Row | Owner / surface                                                        | Bound / dependency                                                   | Tier / effort / failure shape                                       | Verification                                                                                                       |
| --- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| W1  | world_muse → `research/showcase-modular-world-pass.md`                 | 2–3 distinct grammars;3–4 complementary references;D40               | worker-high / high / another forest with decorative asymmetry       | Canonical muse, exact source properties, proposed law and observable same-kit comparison                           |
| W2  | world_contract → `research/showcase-world-reconfiguration-contract.md` | ≤500words;3 task configurations and module/arrangement contracts;D40 | worker-high / high / modularity claimed from unrelated compositions | Same kit identity/joins/scale, replacement/reroute/expand proof and failed forest control defined                  |
| W3  | world_muse → `../media/showcase/v3/studies/world-kit-01.png` + `.md`   | One kit/three-configuration board;W1,W2 accepted as proposals        | worker-high / high / wrong world grammar hidden by polish           | Actual opened comparison demonstrates task-shape changes; generated depiction does not prove procedural rebuilding |

W1 [world muse](research/showcase-modular-world-pass.md) and W2 [reconfiguration contract](research/showcase-world-reconfiguration-contract.md) accepted as proposals after root read. Recommended patchwork workshop uses simple soft game-space volumes and asymmetric boundaries with deliberately compatible joins. Reference evidence is documented product behavior, not newly watched footage or verified internal game algorithms. W3 is a separate one-image study. The rejected forest is excluded from active raster conditioning; its palette roles are carried explicitly while its pixels stay a historical control. No renderer, installed gate or numerical art score exists at this frontier. Asset/light/palette/clock boundaries remain separate. Later motion shows pieces joining/reconfiguring, not a camera glide through a fixed background. Palette evidence remains useful while the retired forest design fails adaptability review.

### W3 opened world-kit comparison

[World-kit01](../media/showcase/v3/studies/world-kit-01.png) is an actual one-generation concept board: six-family tray above A compact working nook, B separated review pockets with connecting route, C opened broader assembly courtyard. Root opened it after the capacity retry. Footprint, route and enclosure differences are visible; this is a useful response to the fixed-forest failure rather than a decoration/camera variation.

**Accept concept exploration only.** Extra stools/rocks/foliage exceed the six-part inventory, pronounced outlined raised ground rims lean toward bounded model platforms, and human/table/companion scale varies modestly between drawings. Reused families are depicted, but exact source instances, joins, contact, procedural rearrangement and motion are not demonstrated. Material/detail/line fidelity remains an upstream visual judgment; neither this PNG nor file checks approve the finalworld.

W1/W2/W3 handoffs complete; generation receipt and guidance closure verified. Next correction: pare back surplus decorative assets, lower/soften the ground joins, preserve readable asymmetric footprints and declare a small module inventory before a moving reconfiguration proof. The law, seam treatment and placement-versus-morphing stay proposed until reviewed. [Exact generation receipt](../media/showcase/v3/studies/world-kit-01.md) preserves tool/prompt/inputs and honest visible limits; palette/human/provider selections remain unchanged.

## Shared creative contract and consequence tracing

Future artifact root: `media/showcase/v3/`. This preserves the failed control and keeps the new shared direction compact.
The current [creative-spec v3-brief-03](../media/showcase/v3/creative-spec.md) freezes the owner-selected B/C construction and open palette frontier; [v3-brief-01](../media/showcase/v3/creative-spec-v3-brief-01.md) preserves the prior comparison input unchanged. This version is a study brief, not approved artwork. Subsequent **creative-spec** revisions bind the goal, source/identity references, narrative roles, human invariants, drawing law, palette/value/light roles, story/color/shot beats, chosen mechanisms and proof links. Scoped specialist outputs feed it; one designated integrator updates its index/version. Workers do not silently rewrite another part's assumptions.

| Information                                               | Writer                         | Readers                                                | Decides                            | Review projection                                              |
| --------------------------------------------------------- | ------------------------------ | ------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------- |
| Product promise, actual interaction and story/shot intent | Director with user rulings     | All design and production passes                       | User/planner                       | Script, storyboard and shot-purpose table                      |
| Human/mascot/world construction and recognition cues      | Assigned part designer         | Director, motion, technique and review                 | User/planner                       | Silhouettes, pose/turnaround keys, integrated cast/world panel |
| Palette, discrete values, lighting and color script       | Color/light designer           | Part designers, animator, compositor and review        | User/planner                       | Grayscale/value key and story-aligned color panels             |
| Technique and replaceable asset/anchor contract           | Producer after verified survey | Asset authors, animator, capture and executable checks | Planner from demonstrated evidence | Actual moving proof, method breakdown and replacement test     |
| Per-gate result, reference revision and corrections       | Reviewer                       | Planner and downstream stage owners                    | Planner/user for visual judgments  | Proof + failed control + explicit failure action               |

A pass must carry: inspected reference properties → narrative purpose → proposed mechanism → invariants/change set → actual proof → shared script/color/spec updates. If it changes upstream intent, dependent passes are reopened visibly. No unverified new MCP parameter or stored-workflow schema is defined here.

## Tiers and task rows

All open rows are **as of 2026-09-30**; they close when their Verify evidence is accepted. Tier entry requires the preceding tier's review. Numeric row IDs are for later compilation; proposed gate names are not installed today.

### Tier 1 — establish the target before design

| #   | St  | File/surface                        | Change              | Bound                                              | Depends  | Verify / closes when                                                                    | Justification                                                         |
| --- | --- | ----------------------------------- | ------------------- | -------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1.1 | ☐   | Research receipts + reference board | Extend              | 3–5 relevant demos                                 | —        | Actual footage inspected; dates and observed/stated/reproduced evidence distinguished   | Text-only motion-graphics leads cannot set the acting/style threshold |
| 1.2 | ☐   | Mascot receipt + creative-spec      | Create spec section | Exact identity pair and roles                      | —        | User confirms source identities; recognition invariants recorded                        | Prevent another unrelated creature design                             |
| 1.3 | ☐   | creative-spec                       | Create brief        | One concrete story goal + first interview frontier | 1.1, 1.2 | Shared outcome, silent format, real/symbolic boundaries and unresolved choices recorded | Reuse prior answers; clarify only missing consequential decisions     |

Tier gate: target examples, mascot identity and brief are concrete enough to judge the next pass.

### Tier 2 — connected design-muse passes

| #   | St  | File/surface                            | Change    | Bound                                                               | Depends                                | Verify / closes when                                                                                  | Justification                                                    |
| --- | --- | --------------------------------------- | --------- | ------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 2.1 | ☐   | script/treatment + creative-spec        | Create    | One story spine and rough value/color intentions                    | —                                      | Story muse → script/shot purpose; real work and symbolic world linked clearly                         | Narrative carries the design, not a late caption                 |
| 2.2 | ☐   | human design study + spec               | Create    | 2–3 meaningful construction alternatives                            | 2.1                                    | Full garment/hair/gesture redesign; rest/reach/contact keys; gate: character-construction             | Another haircut over the same top does not pass                  |
| 2.3 | ☐   | companion design study + spec           | Create    | One coherent pair treatment; source analysis can parallel2.2        | 2.1; final posed integration after2.2  | Recognizable Codex/Clawd in the agreed roles and shared drawing language; gate: mascot-recognition    | Identity replaces generic creature invention                     |
| 2.4 | ☐   | world/drawing study + spec              | Create    | One integrated cast/world value and line key                        | 2.2, 2.3                               | Cel planes, spatial construction and intentional edge categories; gates: cel-form, line-construction  | A uniform outline or texture wash is insufficient                |
| 2.5 | ☐   | palette/light/color script + spec       | Create    | 2–3 provisional relationships parallel2.2; final story-aligned keys | 2.1 for rough study;2.4 for final keys | Focal separation including human vs Clawd; consistent light sources/value families; gate: story-color | Color is narrative structure, not a finishing filter             |
| 2.6 | ☐   | motion/edit study + storyboard          | Create    | Key acting/transition sequence                                      | 2.5                                    | Gesture, grasp, folds, hair settle and pacing carry the scene; gate: motion-coherence                 | Fixed palms and plane shears cannot stand in for designed acting |
| 2.7 | ☐   | integrated storyboard/style proof brief | Integrate | One reviewed shared revision                                        | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6           | Source inspiration, script, color and identities agree; conflicts corrected upstream                  | Prevent drift across specialized passes                          |

Tier gate: an integrated storyboard/drawing/color package demonstrates the intended film; component proofs are actual artifacts, not prompt promises.

### Tier 3 — choose and prove how to produce it

| #   | St  | File/surface                     | Change         | Bound                                                 | Depends | Verify / closes when                                                                                                               | Justification                                                                 |
| --- | --- | -------------------------------- | -------------- | ----------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 3.1 | ☐   | Technique decision               | Create         | 2–3 evidence-backed lanes                             | —       | `tech_recommendation` compares authored NPR3D, drawn2D/compositing and assisted hybrid; API/tool/cost/reproduction limits verified | Choose tools per stage from the required drawing behavior                     |
| 3.2 | ☐   | Small actual quality proof       | Create         | One representative rest→reach/contact→settle sequence | 3.1     | Proposed method produces accepted cel/ink/cloth/light/motion and a same-motion item replacement; current clip fails the controls   | No full render before the risky construction is demonstrated                  |
| 3.3 | ☐   | Canonical workflow/gates + guide | Extend via MCP | Existing pipeline and stage resources                 | 3.2     | Shared artifact mappings, node-local gates and fail→revise routing tested; inspect/preview/validate/write/reload receipts          | Encode the proved methods; no parallel orchestration or manual resource files |

Tier gate: the production mechanism meets the visible threshold and supports the intended replacement/reproduction boundary.

### Tier 4 — produce, review and reproduce

| #   | St  | File/surface                             | Change                      | Bound                                         | Depends | Verify / closes when                                                                                                               | Justification                                       |
| --- | --- | ---------------------------------------- | --------------------------- | --------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 4.1 | ☐   | New production artifacts + source        | Create/extend selected lane | Agreed first demonstration cut                | —       | Shot-level visual gates before each expansion; every asset linked to shared revision                                               | Implementation follows an accepted design/mechanism |
| 4.2 | ☐   | Review, export, rebuild guide and proofs | Integrate                   | One accepted cut and replacement/rebuild test | 4.1     | Actual client build/export/playback; full decode; temporal/visual review; unchanged choreography for swap; source/claim provenance | Codec PASS cannot override drawing/story FAIL       |

Tier gate: the visible demonstration satisfies the agreed artistic criteria and the recorded production workflow can reproduce it.

**New-file justification:** the existing master mixes old iterations and execution history. This focused phase file provides a coherent review frontier. Separate v3 creative studies/shared spec prevent overwriting failed controls; their source/evidence is reusable. No new runtime server, database, prompt catalog or broad application is proposed.

**Execution dispatch:** rows1.1–1.3 require evidence/identity correctness; rows2.1–2.7 risk the wrong design problem; rows3.1–3.3 risk the wrong production approach/contract; rows4.1–4.2 risk incorrect output and missed visual failures. Delegate bounded disjoint artifacts using existing high-review roles, shared-tree mode with no worker ref movement. The integrator owns the shared spec; only one actor drives a live renderer/browser. Actual per-row model/effort binding follows applicable client routing when rows are cut, not a newly invented model alias.

| Row | As of / flips when                                      | Tier   | Effort | Failure shape                             | Branch mode |
| --- | ------------------------------------------------------- | ------ | ------ | ----------------------------------------- | ----------- |
| 1.1 | 2026-09-30 / footage and source evidence accepted       | fable  | high   | Wrong benchmark/problem                   | shared-tree |
| 1.2 | 2026-09-30 / exact mascot references confirmed          | fable  | high   | Wrong identity/problem                    | shared-tree |
| 1.3 | 2026-09-30 / brief and first frontier settled           | fable  | high   | Wrong story/problem                       | shared-tree |
| 2.1 | 2026-09-30 / script and shot intent accepted            | fable  | high   | Wrong narrative                           | shared-tree |
| 2.2 | 2026-09-30 / complete human construction proof accepted | fable  | high   | Wrong character construction              | shared-tree |
| 2.3 | 2026-09-30 / recognizable companion pair accepted       | fable  | high   | Wrong identities or roles                 | shared-tree |
| 2.4 | 2026-09-30 / integrated cel and line key accepted       | fable  | high   | Wrong drawing law                         | shared-tree |
| 2.5 | 2026-09-30 / palette/light/color script accepted        | fable  | high   | Wrong focal/story hierarchy               | shared-tree |
| 2.6 | 2026-09-30 / gesture/acting/edit proof accepted         | fable  | high   | Wrong motion language                     | shared-tree |
| 2.7 | 2026-09-30 / shared revision conflicts resolved         | fable  | high   | Cross-part design drift                   | shared-tree |
| 3.1 | 2026-09-30 / source-grounded technique ruled            | opus   | high   | Wrong production approach                 | shared-tree |
| 3.2 | 2026-09-30 / actual quality/replacement proof accepted  | opus   | high   | Wrong mechanism or controllability        | shared-tree |
| 3.3 | 2026-09-30 / canonical mappings/gates exercised         | sonnet | high   | Wrong resource contract/output            | shared-tree |
| 4.1 | 2026-09-30 / agreed cut meets shot-level criteria       | opus   | high   | Wrong implementation/output               | shared-tree |
| 4.2 | 2026-09-30 / visual and executable evidence complete    | opus   | high   | Missed quality or reproducibility failure | shared-tree |

Tier names are the canonical planning vocabulary, not a current model override or live dispatch. The planner rules unresolved choices and accepts artifacts; it is not a production row. No release/changelog entry is authored for an unimplemented future workflow.

## Proposed quality gates

These are **specifications for future gates**, not installed IDs or automatic art graders. Each records reviewer, proof, revision, verdict and correction. Missing evidence is UNRESOLVED; visual failure blocks downstream production even when executable delivery passes.

| Proposed gate          | Required technique/result                                                                                                                 | Proof and failing control                                                                                  | On failure                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| mascot-recognition     | Preserve official shape/face/appendage/palette cues through the agreed stylization                                                        | Source pair vs posed stylizations; current unrelated creature must fail                                    | Rework identity before lighting/animation               |
| character-construction | Designed garment cut, folds/tension/overlap and rebellious hair create the intended silhouette                                            | Actual rest/reach/contact keys vs unchanged top/chest sleeve/fixed palm                                    | Return to garment/pose design                           |
| cel-form               | Cast/world use designed discrete value planes under coherent light                                                                        | Approved value key + actual lit/shadow pose; continuous world/unlit fixed actors fail                      | Re-author shading/light/form method                     |
| line-construction      | Hierarchy of silhouette, contact/occlusion, folds and selected form edges; taper/pressure/lost edges and shadow-side weight serve drawing | Annotated intent plus actual lit/shadow/contact crops; uniform post-outline/constant tube/no-line controls | Correct selected strokes/weight/attachment              |
| story-color            | Script, palette/value roles and motivated lighting carry the same story                                                                   | Storyboard/color keys vs actual shots; conflicting cast hues or palette drift fail                         | Revise staging, cast pigment and color script together  |
| motion-coherence       | Convincing grasp/weight/hair/cloth plus intentional temporal line behavior                                                                | Consecutive-frame sequence and held pose; current cutout overlap/shear and detached/noisy contours fail    | Rework poses/rig/strokes before full capture            |
| continuity-replacement | Identity/line/color and real contact survive a declared asset change                                                                      | Actual item/pack swap and unchanged motion inputs; misregistered source/false numeric contact fail         | Re-register/redraw, then repeat the relevant proof      |
| delivery-provenance    | Actual artifacts match declared delivery; source and provider claims remain truthful                                                      | Encode/decode/native playback, frozen input/command records; missing/corrupt frame fails nonzero           | Reject delivery and rebuild; never override visual FAIL |

Specific algorithms are selected after source-backed survey and actual proof. A toon ramp is not a drawing pipeline; inverse hull, authored curve/Grease Pencil strokes, pose drawings, shadow masks, compositing or video assistance must demonstrate their role before becoming an implementation gate. No arbitrary artistic score, mandatory band count, linewidth number or unseen quality verdict is introduced. Every dark edge need not become thick; form, light, expression and composition determine the hierarchy.

## Completion criteria

This slice is complete when the evidence, order/dependencies, reuse boundaries and three discovery handoffs are reviewable, plus the one commissioned human comparison sheet is generated, opened and honestly graded as a study. It does not approve final assets, a renderer, animation or installed quality gates.

Future production is complete when the human redesign and branded companions fit the story, the integrated cel/line/color keys and actual moving proof are accepted, the connected MCP workflow is exercised, and the exported cut passes both visible and executable criteria with a real replacement/rebuild demonstration.

## Open interview frontier

- **Q1 — RULED, mascot pair, 2026-09-30:** owner explicitly confirmed the original blue terminal-faced Codex companion + Claude Code Clawd as identity anchors. Stylization preserves recognizable source cues; neither is an invented animal species. Both accompany the human from the opening, as ruled in Q3.
- **Q2 — REFERENCES RECEIVED; synthesis before Tier1.3:** owner supplied Kevin Ngo, shfred, LCSlates, Chetas and the Skillry Opus 5.5 gallery. Retrieved original clips and inspected unaltered frames for the four exact X posts. Assign distinct reference roles below; do not treat every gallery item as equal quality or creator-stated tools as verified implementation. January/February text remains earlier process research.
- **Q3 — RULED, cast/story roles, 2026-09-30:** owner chooses both Codex and Clawd accompanying the human from the opening. The three form the recurring core cast; additional specialists may join as the workflow develops. Preserve friendship, comfort in the world and shared discovery; do not infer provider rivalry or assign fixed provider abilities without evidence.
- **Q4 — OPEN, precise story beats and delivery, before Tier2.1:** carry forward the accepted project focus: a server-guided creative team making this showcase and its own workflow/gates. Decide which real interaction and symbolic action best make that understandable; another concrete task remains an alternative if the user changes scope. The existing bridge and15s length are reference hypotheses, not prescribed final content. Do not ask the user to restate the already settled video/assets focus.
- **Q5 — OPEN, production lane, before Tier3.2:** no engine default. Pick the demonstrated approach that meets drawing/acting/lighting and replacement goals; reject a compelling clip whose controllability/provenance cannot meet the required boundary.
- **Q6 — RULED, selected human construction, 2026-09-30:** owner chooses B with C shirt. Use B swept hair/compact figure/lower clothing with C layered sleeveless outer shirt and pale narrow-sleeved inner shirt. Earlier A-garment recommendation is superseded. Refine selected poses/line construction without reopening the wardrobe choice.
- **Q7 — RULED, palette relationship,2026-09-30:** owner chooses A daylight base with B for focused moments. Keep identity/material pigments consistent; scene source, receiving-light response and staging motivate the shift. C remains a comparison control. Exact target swatches and responsive motion/line lighting still require the production proof.

Questions are discussed sequentially at their dependent frontier. Reuse all prior audience, silent-film, visible-human, comfortable-companion, hand-authored appearance, compact-face and style-reference rulings; do not restart the whole interview.

## Validation and release boundary

Current checks: local research/source/evidence links, plan row/dependency/gate coverage and canonical resource inspections. Future code/resource edits need applicable preflight/library docs and impact-appropriate tests; future visual output needs opened proof and a named judgment. No broad server suite is claimed by a documentation-only plan. No installation, new render, publish, push, issue or PR is authorized by this plan.

| What to test/review                                          | Type and location                                                                | Pass condition                                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Current plan coverage, dependencies and local evidence links | Read-only document/row check in this phase plan and research receipts            | All15 rows have outputs, dependencies, proof and dated flip; local targets exist                          |
| Reference/identity/story direction                           | Source inspection plus user/planner review in shared creative-spec               | Observed versus claimed methods distinct; actual mascot anchors and story purpose settled                 |
| Human/companion/world/cel/ink/color/acting construction      | Opened still/pose and consecutive-frame reviews in scoped studies                | Intended construction demonstrated; named failed controls rejected before expansion                       |
| Selected mechanism and replacement boundary                  | Small real integration proof under the chosen future toolchain                   | Visible style/contact/line-time thresholds met and a replacement repeats the intended action              |
| Canonical stage handoffs and gates                           | MCP validation/mapping/resume integration checks, recorded beside workflow guide | Correct shared revision and prior outputs reach each node; failed proof returns to its owning stage       |
| Delivery/reproduction and product claims                     | Actual render/export/full decode/native playback plus source/command records     | Declared output reproduced; artistic failures not masked; no fabricated provider or verification activity |

Documentation updates follow actual accepted work: shared creative-spec, scoped studies, existing showcase workflow guide and relevant rebuild guide. Current research/plan do not relabel prior art as approved. Risks include wrong mascot/reference identity, isolated muse drift, renderer lock-in, plausible but uncontrolled generated video, and technical checks masking visual failure; each is addressed at its preceding tier gate. Rollback retains the unchanged prior proof/control and only accepted reusable interfaces. No global memory, taste profile or skill edits are made; future release/commit boundaries remain separately scoped.

## Planning path verification receipt

This documentation-only phase plan introduces no runtime signatures. The following independent probes verify the existing integration references; planned v3 artifacts are explicit creations.

### Probe 1

```
-rw-r--r-- 1 minipuft minipuft 13013 Sep 29 22:34 docs/portfolio/showcase-workflow.md
-rw-r--r-- 1 minipuft minipuft 21276 Sep 30 04:12 media/showcase/v2/episode-study.md
-rw-r--r-- 1 minipuft minipuft  6434 Sep 30 06:53 media/showcase/v2/episode/README.md
-rw-r--r-- 1 minipuft minipuft 29920 Sep 30 06:54 plans/demo-video-plan.md
-rw-r--r-- 1 minipuft minipuft 11528 Sep 30 11:21 plans/research/showcase-render-gaps.md
-rw-r--r-- 1 minipuft minipuft  8161 Sep 30 11:27 plans/research/showcase-x-demos.md
```

### Probe 2

```
125 docs/portfolio/showcase-workflow.md
  130 media/showcase/v2/episode-study.md
   86 media/showcase/v2/episode/README.md
   44 plans/research/showcase-render-gaps.md
   67 plans/research/showcase-x-demos.md
  394 plans/demo-video-plan.md
  846 total
```

### Probe 3

```
plans/demo-video-plan.md:14:## Now (2026-09-30)
plans/research/showcase-render-gaps.md:5:## Observed gap and disposition
plans/research/showcase-render-gaps.md:29:## Gate proposal: observable drawing before production expansion
media/showcase/v2/episode-study.md:89:## Reusable asset slots — separate from the episode
media/showcase/v2/episode-study.md:104:## Timed direction — separate from asset files
media/showcase/v2/episode-study.md:120:## Evidence and acceptance boundary
plans/research/showcase-x-demos.md:11:## Three primary creator posts
media/showcase/v2/episode/README.md:67:## Replace an asset pack or crossing item
docs/portfolio/showcase-workflow.md:43:## Seven steps and their consumers
docs/portfolio/showcase-workflow.md:59:## Production artifact contracts
docs/portfolio/showcase-workflow.md:74:## Checks and reviews
```
