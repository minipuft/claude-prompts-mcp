# Human outfit/hair comparison 01 — C4 receipt

Specification: `v3-brief-01` · status: reversible visual prototype, not final art/cast/garment/palette approval.

## Current Stage

ONE original human-only A/B/C comparison was authorized after [C1 synthesis](../../../../plans/research/showcase-human-construction-pass.md). No mascots/world, animation, renderer code, public poster or canonical resource edits were produced. This is a construction study; the original blue Codex and coral Clawd remain core cast in the shared brief but are intentionally absent here.

Built-in `image_gen.imagegen` was used once. No CLI/API fallback, raster edits, extra generation or iteration occurred. The output was copied byte-for-byte and inspected with `view_image`.

## Input references and invariants

- [human-compact-02.png](../../v2/assets/human-compact-02.png): RIGHT figure supplies compact face/body intent, wide eyes, large forehead, tiny nose and tiny full lips. SHA-256: `73beaadb2de307bd8b0db8a6035f047d11647f91197807f338b03577badfc1bd`.
- [hair-drape-01.png](../../v2/assets/hair-drape-01.png): candidate2 supplies careless hair attitude only. The repeated balloon garment is negative construction evidence, not an invariant. SHA-256: `8ceb767e2d3e2b483e5e9d982d4119d3c22e2e25851c08f918e96536940e3e6f`.
- [creative-spec.md](../creative-spec.md): frozen study revision `v3-brief-01`, SHA-256 at invocation: `c736e6f8f2e77cbd9b1f7905469e06b834a9ed3977e4066538a8023091797ee6`.
- Intended controls: same human identity/skin/compactness, three-quarter rest pose, camera, soft upper-left key/cool fill, quiet bone backdrop and low-chroma neutral cloth value families. These are generation intentions, not deterministic equality guarantees or source-derived body ratios.

## Exact image tool request

Tool: `image_gen.imagegen`; `transparent_background:false`; `referenced_image_paths`:

```text
/home/minipuft/Applications/claude-prompts-mcp-showcase/media/showcase/v2/assets/human-compact-02.png
/home/minipuft/Applications/claude-prompts-mcp-showcase/media/showcase/v2/assets/hair-drape-01.png
```

Exact prompt:

```text
Use case: stylized-concept. Asset type: private reversible human outfit-cut and hair-mass comparison sheet, specification v3-brief-01. Produce ONE original full-body A/B/C study, not a public poster or finished character approval.

Input roles: Image 1 (human-compact-02.png) anchors ONLY the RIGHT-HAND human's compact body and face intent: warm brown skin, large open forehead, wide-set eyes, tiny simple nose, small but full closed lips. Repeat the SAME human identity/skin/face/compactness in all three columns. Image 2 (hair-drape-01.png) contributes candidate 2's loose rebellious hair ATTITUDE only. Its identical balloon sleeves/top repeated across all figures is a NEGATIVE construction control; do not keep that garment and merely change the haircut. Neither input is permission to copy existing source-cast identity.

Layout: landscape bone/ivory background, three equal columns labeled ONLY "A", "B", "C". Full body and feet visible in the same gentle curious relaxed three-quarter pose, same camera, figure scale and soft upper-left open daylight with cool sky fill. Below EACH figure include a small waist/arm reach-contact drawing if feasible: same action/view/height, one hand lightly grasping a simple plain neutral practice block; clearly show armhole, elbow, cuff/hand and torso overlap. No other people, mascots, world, symbols or marketing copy.

Common material/color: same low-chroma warm-neutral cloth family and quiet slate/charcoal lower layers; color must not do the differentiation. Roomy hanging torso mass, purposeful loose drape, ordinary sophisticated everyday clothes, plain soft shoes. Defined shoulder/armhole and narrower controllable forearm/cuff CAN coexist with generous torso folds. Do not flatten every option into tight basic clothes.

A: OFFSET-PANEL PULLOVER. Rounded neck, defined shoulder/armhole rather than the huge continuous balloon shoulder. Roomy torso, straight narrower forearm sleeve ends above hand, short layered diagonal hem panel with actual overlap anchored to the opposite side. Loose cropped/tapered trousers. Hair: one broad unequal swept crest with a few escaped angular tufts and clear open forehead. Rest and contact inset show the real hem overlap and armhole-to-elbow tension.

B: LONG COLLARLESS RAGLAN SHIRT. A recognizably different longer hanging torso, raglan shoulder seam, split side vents, narrower straight cuff with open hand clearance; simpler narrower loose trousers under the longer top. Hair: a low backward fan of unequal curved clumps, without repeating the big top loop from Image 2. Contact inset shows sleeve travel and side-vent separation, not balloon cloth across the chest.

C: SHORT PLAIN SLEEVELESS OUTER LAYER over a narrow-sleeve soft inner top. Collarless outer top with a displaced plain front overlap and curved short hem; generous softly rounded lower-trouser volume, plain shoes. No utility pockets/belts/gear. Hair: compact uneven gathered/crown mass plus one escaped trailing lock and clear forehead. Contact inset exposes independent outer layer, inner sleeve and wrist/hand ordering.

Drawing: expressive original graphic construction, explicit designed cel light/shadow planes, purposeful dark tapered occlusion/contact/compressed-fold contours, lighter or lost selected light-facing edges. Not uniform thick outlines everywhere. Subtle surface tooth stays subordinate to coherent form. Soft painted game-space volume without photoreal skin, fur, pore detail or PBR sheen. Face and hair stay stylized and approachable, not baby-Disney polish or rugged adventurer. No literal drawing powers, stereotyped cultural motifs, iconic costumes, source-film cast, sash, harness, distressed explorer coat, heavy strapped boots or unrelated props. The three CUTS and hair MASSES must genuinely differ; preserve the same human identity.
```

## Actual output

[human-outfit-hair-01.png](human-outfit-hair-01.png): **1536×1024 PNG**, **1,751,443 bytes**.

SHA-256: `ee5f9254f88d11f34721a3368041b8ea3a2ebf5d4235ebce48e453cb7dcdf321`.

Built-in original: `/home/minipuft/.codex/generated_images/01a0f074-5a05-7b11-9e04-3ad5982daf4d/exec-d36041bb-2e06-45f3-ab67-c9616058315b.png`. Source and workspace-copy hashes match. The original remains in place; no rescale/crop/repaint/montage was applied.

## Visible Shape and Medium Review

**Observed:**

- A shows a shorter crossed/layered hem, cropped loose trousers and an uneven swept hair mass.
- B shows a longer shirt with a front/side opening, longer trousers and backward-swept clumps.
- C shows a visibly separate sleeveless outer layer over a lighter narrow-sleeve top, rounder trouser volume and gathered hair.
- All are full-body, in a neutral family on a bone backdrop. Three contact insets are present, with narrower cuffs and hands touching the same simple block.
- Matte planar cloth shading and garment-overlap edges are visible. No mascots, world, slogans or labels beyond A/B/C appear.

**Concerns / unproved:**

- A and B still share similar raglan-like shoulder seams; A's intended distinct set-in/defined armhole construction is not conclusively demonstrated.
- Contours remain mostly fine; localized heavier overlaps do not establish the entire requested tapered occlusion/contact versus lost-light-edge hierarchy.
- Insets show resting/open hands on the block, not a convincing wrapped grasp. They cannot establish motion, tension changes, temporal cloth behavior, registration or a rig.
- Cloth values differ across A/B/C despite a shared neutral family. Face/body scale and warm orange-brown skin read should be reviewed for continuity and the requested brown-skin intent; exact invariance is not claimed.
- Rest/reach comparisons do not supply the complete front/three-quarter pose set. No construction, palette or final cast is accepted from file existence.

## Owner Grade / Root Lock / Break Control

Root opened the actual sheet and accepted it as a **useful direction comparison only**, recommending A's garment with B's hair for a possible next construction pass. The user choice remains pending; that mixed combination has not been generated or proved here. Root also noted similar A/B shoulders, fine line hierarchy, resting-palm contact and differing clothing/trouser values. C1's prior haircut-only sheet remains the negative construction control. There is **no final artistic PASS**, cast/garment adoption, motion approval or automated artist-judge result.

## Canonical asset-study invocation / receipt

Existing `showcase_asset_study` was invoked with explicit human-comparison-only scope, current root authorization and `v3-brief-01`. No new resource IDs/arguments or prompt/gate mutation.

Exact command:

```text
>>showcase_asset_study brief:"C4, frozen v3-brief-01: ONE reversible human-only outfit CUT plus hair MASS A/B/C comparison sheet, not final art approval. Preserve compact accepted right-hand body/face intent; warm brown skin, wide eyes/large forehead/small nose/tiny full lips. Defined shoulders/armholes/narrow controllable forearms coexist with larger hanging torso folds. Same face, compactness, view/rest pose, neutral bone background, soft upper-left daylight and low-chroma neutral clothing families. Original blue Codex + coral Clawd are settled core cast but NOT drawn in this human sheet. No repeated balloon garment, explorer, stereotyped symbols, photoreal skin/fur/PBR, literal drawing mechanics. Small same-action reach/contact inset per candidate if feasible. Only A/B/C labels. No extra generation or motion/rig claim." references:"media/showcase/v2/assets/human-compact-02.png: preserve RIGHT figure body/face intent. media/showcase/v2/assets/hair-drape-01.png: candidate2 hair attitude ONLY; balloon garment is negative construction evidence. plans/research/showcase-human-construction-pass.md: actual C1 synthesis. media/showcase/v3/creative-spec.md revision v3-brief-01." frames:"/home/minipuft/Applications/claude-prompts-mcp-showcase/media/showcase/v2/assets/human-compact-02.png; /home/minipuft/Applications/claude-prompts-mcp-showcase/media/showcase/v2/assets/hair-drape-01.png" output_root:"media/showcase/v3/studies" context:"Root explicitly authorized C4 ONE original comparison and receipt after C1; images inspected, no redundant owner question needed. Shared brief is v3-brief-01, no final artwork/cast/outfit or motion approval. Own only human-outfit-hair-01.png and human-outfit-hair-01.md plus finish C1 doc. Resources unchanged. Client uses built-in image_gen once; preserve output unchanged, inspect actual sheet and report concerns, do not art-PASS from file existence."
```

The successful render returned `chain-showcase_asset_study#1`, review reminder `showcase-asset-continuity`, and stage-aware instructions. The client performed reference inspection, one image generation, unmodified copy, actual image review and this evidence record. It did not infer motion/rig/artistic success from delivery.

After consuming the guidance, `prompt_engine(chain_id:"chain-showcase_asset_study#1", cancel:true)` returned **Chain Cancelled**, `isError:false`. No artistic PASS was submitted; retained session artifacts are runtime evidence, not canonical resource edits. C1's separate `chain-design_muse#3` was also cancelled cleanly after synthesis.

## Artifact Evidence / Next Authorized Action

Completed: reference/output inspection; PNG header/dimensions; byte-count/hash; unmodified-copy equality; local-link/format checks. No runtime artist judgement, motion/render test or publication.

Root reviews the cut/hair and continuity concerns before selecting a construction or requesting a targeted follow-up. No second image was silently generated. Full pose/contact proof and integrated trio palette remain future separately scoped work.
