# C6 — CloudySky contracts, animation palette candidates

## Context

Planning against [creative-spec](../../media/showcase/v3/creative-spec.md) `v3-brief-02`. Inspected [comparison01](../../media/showcase/v3/studies/human-outfit-hair-01.png): preserve **B's swept hair, compact face/body and lower silhouette; C's layered sleeveless outer shirt and pale narrow-sleeved inner**. The assembled selected-human master is still required before a palette board. Original blue screen-faced Codex and coral block Clawd remain recognizable from the opening. No board, motion test or renderer selection here.

Canonical `design_muse` rendered C6 as `chain-design_muse#2`, then cancellation succeeded; no artistic PASS. Exact request/render/cancel receipts retained in tool history and stores `showcaseC6MuseRequest/Render/Cancel`.

## Analysis

**Evidence classes:** personally read CloudySky [CLAUDE](/home/minipuft/Applications/cloudySky/CLAUDE.md) and [Design Bible](/home/minipuft/Applications/cloudySky/docs/DESIGN_BIBLE.md). Its bible expressly separates locked vision from runtime achievement. Explorer's supplied source audit is authoritative for the following code findings; I located filenames, did not duplicate tracing, run tests or inspect its live client.

| Stage           | Source finding → animation transfer                                                                                                                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Source**      | [assemble](/home/minipuft/Applications/cloudySky/src/features/color/PaletteCoordinator.ts:203) distinguishes identity/functional accents from field pigments. Keep official mascot recognition pigments separate from environment/material families; human sheet supplies neutral relative values, not a secretly chromatic palette. |
| **Grade**       | [ColorMaster](/home/minipuft/Applications/cloudySky/src/features/color/ColorMaster.ts:24) carries role/material and unbounded chroma, with L≤1. Author common shadow/ink/value relationships without recoloring identity. A real extraction/grade computation remains unperformed.                                                   |
| **Composition** | [linear canvas projection](/home/minipuft/Applications/cloudySky/src/features/color/utils/colorOdt.ts:167) retains unclamped values; radiance arises downstream. Separate pigment from named key/fill/ground receivers. Our opaque cel world need not emit additive light.                                                           |
| **Envelope**    | [rekeying](/home/minipuft/Applications/cloudySky/src/features/color/utils/gradientColors.ts:384) and documented role constraints address contextual reading. Judge silhouettes, skin/shirt separation, facial marks and contact against actual backgrounds; import no APCA/UI floors or dark-field defaults.                         |
| **Output**      | [gt7Compose](/home/minipuft/Applications/cloudySky/src/shaders/composeOperatorGlsl.ts:157) owns final projection. Preserve scene relationships until one explicit target transform. First board/export scope: ordinary SDR/sRGB preview; actual video color tags/gamut/clipping require later proof. No HDR/P3 claim.                |

Audit traps: [highlightOp default](/home/minipuft/Applications/cloudySky/src/features/visual/tuning/tunables.ts:245) is **1=PBR Neutral**, despite older AgX comments; that is not our selected operator. [gradientInputs](/home/minipuft/Applications/cloudySky/tools/cdp/color.mjs:225) is explicitly a **stale initialization snapshot**, not frame truth. Perceptual pigment travel and linear illumination are different operations; do not import the audio/DOM transition engine.

**Reference roles:** [Ni no Kuni](../../media/showcase/v2/references/ni-no-kuni.jpg) supplies soft green spatial depth; [Okami](../../media/showcase/v2/references/okami-hd.jpg) supplies selected ink/form construction, not glowing spectacle. [Kevin/shfred](showcase-x-demos.md) support coherent substrate and narrative value masses; [LC/Chetas](showcase-user-reference-workflows.md) support material-aware revision and restrained expressions. Unchanged [Codex](../../media/showcase/v3/references/codex-official-v4.webp)/[Clawd](../../media/showcase/v3/references/clawd-official-demo.gif) and [provenance](../../media/showcase/v3/references/identity-references.json) protect blue/screen/cyan versus coral/dark eyes. These are observed roles, not sampled/computed swatches or verified creator techniques.

## Goals

Transfer the five contracts, **not** dark additive watercolor, glass/lenses, album rescue or Pandora's numbers. Neutral cloth/grey sources retain neutral values; any moss/plum counter-family is explicitly authored from reference relationships, not extracted from grey. Preserve source skin hue, blue Codex/screen-glyph contrast and coral Clawd/eye contrast through the proposed lighting.

Ink explains silhouette, occlusion, cuff cavity, grasp and scaffold joins; selected shadow/contact edges gain weight. Taper or lose lit/open edges where form remains readable. Pigment/substrate texture does not create lighting or repair garment construction.

## Execution

**Three relationships, unchanged cast construction:**

| Candidate                  | Pigment, light and provisional action                                                                                                                                                                                                                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — cloudlit grove**     | Cream/sage ground, blue-green distant depth; human neutral cool-taupe outer/pale inner, dark lower mass. Warm upper-left filtered daylight/cool sky fill separates skin, Codex blue and Clawd coral. Trio compares one rough shot-panel, seats it in a soft scaffold. Benefit: familiar organic space; risk: low-contrast mush.                    |
| **B — warm threshold**     | Quiet mauve/blue-grey enclosure, human muted moss outer/pale inner. One warm side-opening lights faces/hands; cool fill retains shadow form and a pale backing protects Codex. Trio carries the panel from shade toward the opening, then corrects alignment. Benefit: motivated attention; cost: identity-safe relighting; risk: theatrical glow. |
| **C — overcast ink field** | Bone/grey-green world, human restrained plum-grey outer/pale inner. Broad neutral upper-left sky, charcoal/violet shadow/ink families; mascot pigments are sparse color anchors. Trio turns, reviews a rough composition, revises and extends one scaffold. Benefit: drawing clarity; risk: flat paper tableau.                                    |

All actions remain **provisional** illustrations of making the video/workflow through the server. Exact brief/handoff footage needs actual evidence; no approved gate symbols, success lamps or provider powers are invented.

## Evaluation

After the selected-human source arrives and root authorizes a board: compare **A/C** on the same scene, pose, camera, trio scale, line intent and source revision; then isolate light versus pigment if attribution is unclear. B tests a different staging relationship, not a global warm overlay.

Quality record: artifact/hash, spec revision, source/grade inputs, named light/receivers, pose, frame/time, viewed output, failing control, observation, reviewer and corrective stage. Use the rejected unlit-cutout/continuous-world clip as control. Later inspect consecutive turn/reach/contact/correction/settle frames and a declared asset swap; delivery/decode cannot art-PASS them.

## Refinement

Start with A versus C: soft depth versus ink-led reading. Reverse A if shirt/cuff/mascot separation collapses. Early relationships can parallel human refinement; final keys depend on its assembled master, contact poses and storyboard. `capture: none — goal-local evidence only`. Remaining forks: lighting relationship and dominant human outer-shirt family. No generation yet.
