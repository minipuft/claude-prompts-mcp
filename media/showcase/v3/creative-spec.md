# Showcase creative specification

Revision: `v4-brief-22` · 2026-10-13 (D78 worlds and guides; D79 65 seconds; D77 cinematography sheet per shot; D75 human model sheet approved; D76 clean-up contour re-based to the approved sheet; D74 colour script per shot from the owner's library; D73 2D deformation rig; D72 craft baseline: pose-to-pose with generated key sheets, model sheets, timing charts, clean-up standard; D70 row 2; D71 part rendering) · status: style bible and story brief; no final artwork or motion approval. Supersedes `v3-brief-04`, preserved unchanged as [creative-spec-v3-brief-04.md](creative-spec-v3-brief-04.md).

## What changed from v3

The v3 briefs reached a consistent human, the official Codex and Clawd identities, and a six-piece modular kit, then stalled because every stage emitted into a different medium and nothing composed. v4 fixes the substrate, the palette law and the story in one document. The v3 daylight palette ruling (D39) and the fixed-forest retirement (D40) are superseded by D44 below; the human selection (D38) and mascot identities (D35, D36) stand.

## Rulings carried and new

- D35/D36 (carried): original blue terminal-faced Codex and coral Claude Code Clawd accompany the human from the opening.
- D38 (carried): human is the B figure with the C layered shirt, as drawn in [human-selected-02.png](studies/human-selected-02.png). Frozen; no further regeneration.
- D41, owner, 2026-10-06: medium is Remotion as the single substrate; the Three.js kit beat mounts inside it through `@remotion/three`. Verdict and comparison recorded in the tech_recommendation pass (chain-tech_recommendation#1).
- D42, owner, 2026-10-06: the tool is a frame the companion holds up. Looking into it reads as nearly infinite, as if a whole other world lies inside.
- D43, owner, 2026-10-06, corrected 2026-10-07: the gadget is a hybrid machine in the spirit of The Midnight Gospel's universe simulator: familiar parts, an impossible whole, organic and mechanical at once. The planner first recorded this as Mind Game; the owner's word was "gospel". Not a device with buttons, not an abstract orb.
- D45, owner, 2026-10-06: the frame interior must read as someplace else, not a flat picture. It needs refraction and diffusion: what lies behind the frame is displaced, softened and edge-shifted as through glass. A flat gradient, however rendered, fails. This moves the frame interior to a GPU pass (Three.js inside Remotion).
- D46, owner, 2026-10-06: the world inside the frame is the entire environment, not one piece: the assembled kit standing for the gates, frameworks, prompts and resources of the script and plan. Beat 4 reveals the whole destination through the frame; beat 5 builds it one piece at a time.
- D47, owner, 2026-10-06: shadows are intentional shapes, as on the board's sticker sheets: a drawn form shadow that follows the silhouette and a cast shadow on the field, each a designed shape with a weighted edge. A flat lower band is not a shadow.
- D48, owner, 2026-10-07: the glass pass is the right path. Shadows keep evolving toward The Midnight Gospel's look: gradients built from dither and stipple, not smooth ramps, so a shadow reads as drawn texture while still grading across a form.
- D49, owner, 2026-10-07: the architecture inside the frame stays organic but familiar to the workflow being solved. The meta narrative: these bots are standardizing their own design process, which is what this project is doing, and the showcase prompt chain scaffolded in the server is the evidence trail a viewer can run.
- D50, owner, 2026-10-07: the architecture inside the world follows Dr. Seuss's Midnight Paintings (six filed in `references/seuss-*`): swooping organic towers, stacked pointed arches, curling stalks with flag leaves, pale thin contour outlines on a black field, light as beaded strings. The frame interior is constructed as receding hand-drawn frames, each slightly turned (the nested-frames painting). Their outline and silhouette language may inform new assets. Colors and the exact architecture inside the frame are provisional for this test demo; the Codex and Claude identity pigments still do not change.
- D51, owner, 2026-10-07 (confirmed): the animation language is "drawn on twos, light on ones" (section below), a hybrid of The Midnight Gospel's drawn layer, CloudySky's force-with-memory light doctrine, LCSlates' material transformation and shfred's cut-driven progression; the early-web explainer tween is the named failing control.
- D52, owner, 2026-10-07: line boil is visible, toward The Midnight Gospel's wobble, not subtle.
- D53, owner, 2026-10-07: the opening frame is the poster. Frame 0 of the film doubles as the GitHub thumbnail, so at a glance it must say what the project is and what is about to happen: the project mark, the trio, the box, on the settled black field. The film never opens on the overwhelm state; beat 4's brightness is the end of beat 3, not the opening.
- D54, owner, 2026-10-07: the human's skin is an identity pigment between Clawd's coral and Codex's blue, so the trio reads as a tricolor, in the mauve-pink family the Midnight Gospel and Seuss references use. Owner chose B, green `#67b479`, with A, mauve `#c885c2`, as the shadow-side step (`studies/skin-10.md`); both are identity pigments in `tokens.ts` and never grade. The trio is coral, blue, green.
- D55, owner, 2026-10-07: no asset or approach is accepted as its first iteration. Between iterations a muse pass runs (`showcase_asset_muse`: design_muse on the filed references and the existing cast, then 3+ variants rendered side by side in the substrate as an `AssetSheet`, then a rubric grade). A variant must cite the reference properties it borrows and the cast property it sits between; the pick is the owner's and the losers stay as controls. The beat1-11 human is the failing control: a first draw that cited nothing.
- D56, owner, 2026-10-12: the board (`references/board.json`) is a clean slate: references, laws and anti-references only. Nothing the project has drawn, no muse sheet, no study still and no failing control appears on it; those live under `studies/` and are graded against the board, never shown beside it. The previous demos are weak and are not inspiration.
- D57, planner assumption under D53, 2026-10-12: no captions beyond the held title; flips on any owner word naming a beat that needs one.
- D58, planner assumption, 2026-10-12: frame bars gold from the nested-frames painting; flips if a still reads the frame as part of the gadget.
- D59, owner, 2026-10-13: the production is two server chains. `showcase_preproduction` runs once per episode (board → story and beats → shot list and object inventory → package grade behind the `showcase-review` gate); the muse then runs once per object from the inventory (`showcase_asset_muse`). `showcase_shot` runs once per shot (timing table → render study → rubric grade behind the gate → evidence). The shot list `v3/shots.json` is the handoff between them.
- D60, owner, 2026-10-13: a shot run feeds the script. The evidence step writes the measured frame range into the shot's `measured` field and into that beat's provisional range in `script.md` with a dated note; the owner's beat text is never rewritten.
- D61, owner, 2026-10-13: a render study produces a frame set, never one still: first, key, last and a six-frame consecutive strip around the key, plus the determinism, twos/ones and identity-pigment probes, so the review grades at the evidence tier the rubric demands.
- D62, owner, 2026-10-13: Blender is an optional path on the render study, taken only when the request names `renderer:blender` and `tool:blender_render`. It is a script tool with an explicit trigger and a confirmation, refusing with a named reason when no Blender binary is reachable (none is, in this WSL2; the Windows host is the place to run it). The server has no Blender feature of its own; script tools (`docs/guides/script-tools.md`) and the workflow `remainder` (`docs/reference/workflow-ir.md`) are the documented mechanisms this path uses.
- D63, owner, 2026-10-13: Codex and Clawd stay as the identity anchors, but their construction may morph to match the world; they do not keep their default style. Identity pigments remain fixed (C1); silhouette, contour and shadow language follow the board like every other object, so each companion gets a muse pass whose variants cite the official sprite only for pigments and recognizable features.
- D64, owner, 2026-10-13: the fewest cuts. Beats progress by morphs, transitions and camera moves that follow leading lines the world provides (a stalk's curl, the beaded string, the frame's edge, the structure's silhouette); a cut is a last resort and the shot row must justify it. This replaces the edit-layer rule "beats progress by cut and reframe, not by pans; the camera is locked within a beat".
- D65, owner, 2026-10-13: hand-coded SVG characters are the wrong tool (sheets 11, 14, 15 are the failing controls). Every asset is drawn by an image model from board images as inputs, through Codex's image tool driven by `codex exec -i <ref> … -- "<prompt>"` from a script tool in the muse chain, so the bible is enforced by image input and the exact `referenced_image_paths` are receipted. The owner picks from generated sheets; the pick is cut into layers (rembg + VTracer), quantized to the five roles with identity pigments pinned, and animated as a cutout puppet in Remotion (pegs, one pivot each, on twos; blend passes multiply/screen/add over the layers; boil as generated contour variants or a seeded noise pass). Remotion stays the substrate. A style LoRA on the host GPU is HELD until twenty accepted drawings exist. Verdict and sources: tech_recommendation 2026-10-13 (chain-tech_recommendation#1); first proof `studies/drawing-source-01.png`.
- D66, owner, 2026-10-13: `codex exec` with attached references is the default drawing source for every generated asset; the `imagegen` script tool (`media/showcase/scripts/imagegen/`) is its only entry point, so every generation carries its prompt, `referenced_image_paths`, source path and sha256.
- D67, owner, 2026-10-13: generation covers more than characters: character sheets, silhouette explorations, environment and world-building plates, and derived maps (depth, normal) as baselines, all composed together in the substrate; gaussian splats from reference video are allowed as reference or animation input when a shot needs them. Linework is incorporated as a pass once the real scene renders, not drawn into the plate. Taste default accepted: characters quantized to five flat roles, interiors keep their painted texture.
- D68, owner, 2026-10-13: there is no video model and there will be none; a generated still is never animated by generation. The translation layer is the contract: every generated plate is cut into layers (parts for characters, planes for environments), bound to roles, and moved programmatically by `motion.ts` under the animation language, so the bible, not the model, decides motion. A plate that cannot be cut into movable layers is rejected at the sheet step.
- D69, owner, 2026-10-13: the human is the middle direction of `studies/human-gen-16.png`, the Swoop (diamond-shouldered top, long thin limbs, large hands, one trailing swoop of hair). The human arrives wearing the heavy Cloak (the left direction) and transitions into the Swoop; the transition is a story event, not a costume cut. Planner default for its place: the cloak falls at beat 4 when the frame rises and the human looks through it, so the Swoop builds beat 5; flips on the owner's word. The face is iterated on its own sheet (eye spacing, eye-to-mouth distance, head shape) against the states the puppet must animate (neutral, blink, mouth, look), and the pick names what the face can do.
- D70, owner, 2026-10-13 (revised the same day from row 3 to row 2): the human's face is row 2 of `studies/human-gen-17-faces.png`: a rounded head, eyes wide apart, mouth low; its four cells (neutral, blink, open mouth, look) are the face states. Because those marks are small, every shot run ends with an identity pass: the head rendered at the shot's actual on-screen size and checked that the face and the trio's identity remain trackable; a face that vanishes at that size is fixed by enlarging the marks, never by changing the head.
- D71, owner, 2026-10-13 (the rig does not reach the organic shape): cut parts are never rendered as hard nearest-colour pixel blobs. Every part carries a soft antialiased alpha (blurred mask, sigma ≈ 1.1 px at plate scale) and a pale contour halo one step lighter drawn under it (the Seuss contour, ~5 px at plate scale), with the traced vector (VTracer spline) as the alternative rendering; the rig sheet compares hard, soft+contour and vector+contour side by side before a rendering is chosen. Compared on `studies/rig-sheet-02.png` (2026-10-13): hard shows stair-stepped contours, soft and vector read as drawn lines; soft+contour is the default (keeps the stipple the vector flattens), vector reserved for parts that scale large. The puppet draws a child below its parent's z behind the parent, which is how the hair sits behind the face.
- D72, owner, 2026-10-13 (the bar is CalArts-grade character animation, professional and crafted): the production is pose-to-pose. Acting lives in key drawings the image model draws from a model sheet; the puppet draws nothing and only carries holds, breakdowns and inbetweens between consecutive keys, with the skeleton of `studies/tech-rig-01.md` as the registration tool when its toolchain is present. The expensive path is consolidated into sheets so it stays efficient: one model sheet per character, generated once and approved (turnaround front / three-quarter / side on one baseline at one scale, construction volumes, a proportion ruler in heads, the D70 expression states, a hands row), and one key sheet per shot and actor (every key the timing chart names, 4–8 keys on one plate at the model sheet's scale, numbered, each with its line of action) so a shot costs one generation per actor plus the regeneration of rejected keys. Timing charts are the motion contract (section below). A clean-up standard governs every plate before it is cut (section below). The rotation-only puppet of `studies/puppet-proof-02` and the hand rig of `rig-sheet-01/02` are the failing controls. Rubric C20–C23.
- D44, owner, 2026-10-06: the world is not calm daylight. Saturated figures and objects on a black field, readable as negative space. The owner's [style board](references/style-board-2026-10-06.png) is the primary reference ([index](references/style-references.json)).

- D73, owner, 2026-10-13: no 3D characters. The puppet becomes a 2D mesh-deformation rig (AnimatedDrawings ARAP core ported to TypeScript, rendered through @remotion/three); drawn key plates are sibling meshes on one skeleton. Decision and prior art: `studies/tech-rig-02.md`; measured target cadence: `studies/craft-ref-01.md`.
- D74, owner, 2026-10-13 (default taken on the planner's recommendation): one hue pair and one emitter per shot, chosen from the owner's own Eagle saves (board-06 §7). The pair is the radiance hue plus one local accent on the black field; identity pigments never grade (C1). Shot table below; `shots.json` carries the hex pairs.

- D75, owner, 2026-10-13: the human model sheet `studies/human-model-01.png` is approved as the identity contract (`assets/human/model.json`, `provisional: false`): three views within 0.4 %, ruler 8 heads (lower bound), expressions 7–10, hands 11–14.
- D76, owner, 2026-10-13 (asked as "re-base to the plate's 1/240", applied as the sheet's own ratio): the clean-up contour standard is the approved model sheet's measured line, not a fixed fraction. The generator draws a near-constant 2.8 px line at plate resolution, so a ratio moves with figure height: the pick measured 1/240 at 680 px, the approved sheet 1/166 at 470 px. Keys are compared to the model sheet at the same figure height, ± 20 %. The human's standard is therefore 1/166; `model.json` `contour.ratio` carries it and `scripts/model_measure.py --ratio` reads it.

- D77, owner, 2026-10-13 ("something that shows the full cinematography consideration in the next sheet"): every shot gets a cinematography sheet before its keys, one generation through `showcase_layout_sheet`: the frame at the start of the shot's move and at its end, a top-down staging plan with the camera path, the leading line the move follows (D64), the emitter and the D74 hue pair, the figure's on-screen height in heads, and the Composition cards it borrows from (board-06 §8, filed from the owner's library through /inspiration). The key sheet is drawn at this camera; the render study measures the figure's on-screen height against it (C25). The shot chain is layout → motion → keys → render → grade → evidence. Dynamic poses are tested as the shot's own keys at this camera, never as a second rig lift.

- D78, owner, 2026-10-13: worlds and guides. Codex and Clawd guide the human (the user) through worlds the frame opens onto, each a workflow of the server in its own style: the **art world** in crayon (prompts and resources; Clawd leads), the **programming world** shaded and futuristic with emissive edges (chains and gates; Codex leads), and the **line world** as every crossing (everything reduces to its contour lines, the lines re-route along the move's leading line, then refill in the next world). Home is the Seuss black field. A world is a renderer over the one rig: keys, charts, model sheets and layouts are shared; a world changes materials, passes and backgrounds only (`src/library/worlds/`, contracts `v3/worlds/<world>.json`, a `showcase_world_sheet` per world). Identity pigments hold across worlds (C1); silhouette and line follow the world (D63).
- D79, owner, 2026-10-13: 60–70 seconds, so the server's vision is understood; the beat ledger `beats-v2.json` is the provisional story at 65 s, eight beats, six shots. `beats.json` (40 s) stays the composition's input until the shots are rebuilt. The owner is asked at named plot points (the ledger's `asks`) so pacing stays organic.
- D88, owner, 2026-10-17 (interview round 1, question 1): the register is warm, playful and inviting, in the spirit of Elmo (Sesame Street, Elmo's World) and its kin, where a child is met by a world that wants to play with them. Reverence is reserved for the frame rise (beat 4) and the final settle (beat 8); everywhere else the failures are gentle gags and the guides have personalities. Every pose, timing band and acting note is graded against this register first.
- D89, owner, 2026-10-17 (question 2, "a good starting point"): the human carries the audience's eyes, Clawd the heart and Codex the humour. Clawd leads by touch, Codex by gesture. The companion lean-in variants and the close framing in each world follow from this; it is a starting point, revisited once the acting is watched.
- D90, owner, 2026-10-17 (question 3): the one remembered image is not ruled yet, because pacing and impact cannot be judged without an artifact that shows the whole script at once. The chain produces an edit sheet (`v3/edit-sheet.json`, rendered to `out/edit-sheet.html` by `scripts/animation/edit-sheet.mjs`): every beat with its seconds, frames, world, guide, register, what the light pushes, keys and holds counted from the exposure sheet, a frame from the latest animatic, the open asks, and the shift every later beat takes when a beat's seconds change. The owner edits and iterates on that sheet; the ruling on the one image waits for it.
- D91, owner, 2026-10-17 (question 4): the lighting always acts in favour of the emotional impact, and the scene is composed to support what the lighting pushes, never the other way around. The light script is upstream of blocking and poses: each beat names the feeling its light drives, and the layout and pose steps read that line before they place anything. The emitter tints, the arrival intensity and the crossing fade are judged by whether they push that feeling.
- D92, owner, 2026-10-17 (question 5): timing and acting references are named on the board, not implied: Kyle Baker and Genndy Tartakovsky for holds and snaps, Studio Ghibli for weight on contact, and Ghibli's habit of drawing the details only a child would notice, so the world reads as lived in and the detail builds character. Each is filed with its facets and a why; the timing bands in the chain are re-cut against them.
- D93, owner, 2026-10-18 (round 2, question 3, "default, I am enjoying your vision"): the one remembered image is the frame rise, beat 4: the human small and lit from inside the frame, the cloak falling. Beat 4 takes 10 s (from 6), the art and programming worlds 10 s each (from 12); the total stays 65 s. The first pose work of animatic 04 goes to beat 4, and the ending stays wide and small by contrast.

## Craft baseline: pose-to-pose, consolidated into sheets (D72)

| Artifact | Once per | Produced by | Contains | Accepted when |
| --- | --- | --- | --- | --- |
| Model sheet | character | `showcase_model_sheet` (imagegen from the approved pick + its board cards) | turnaround front / ¾ / side on one baseline at one scale; construction volumes under each view; proportion ruler in heads; expression states (D70); hands row (open, point, grip, hold) | views agree in scale within 5 %; `assets/<character>/model.json` records heads, limb ratios, contour weight |
| Cinematography sheet | shot | `showcase_layout_sheet` | start frame, end frame, staging plan with camera path, leading line, emitter, hue pair, figure height in heads on screen, Composition cards → `v3/layouts/<shot>.json` + `LayoutSheet` still | the key sheet is drawn at this camera; the render study's figure height matches it ± 5 % (C25) |
| Timing chart | shot and actor | `showcase_motion` | the key list (K1…Kn: frame, pose in words, line of action, what changes from the previous key) and, per key pair: hold, anticipation, breakdowns with favouring, smear, overshoot, settle, all on twos; staggers, light lag, boil, seam pulses, camera | every pose the shot needs is a key or a charted breakdown; nothing is left to the rig |
| Key sheet | shot and actor | `showcase_key_sheet` (imagegen from the model sheet + the pick + the shot's cards) | every charted key as a full figure, numbered, one plate, model-sheet scale | each key overlays the model sheet within 5 % (C20), fills to a readable silhouette (C21), passes clean-up (C22); a failing key is regenerated once with the failing property named |
| Key plates | key | `scripts/cutout.py --field black` on the key sheet | one role-quantized plate per key with soft alpha and contour (D71); joints registered when the skeleton toolchain is present | the puppet holds and inbetweens between consecutive plates; it never redraws |

Clean-up standard, measured on the plate before the cut: contour weight equal to the character's approved model sheet (`assets/<c>/model.json` `contour.ratio`, 1/166 for the human; D76) ± 20 % at the same figure height; tips taper; every shape closes; the contour is one step lighter than its fill per role; no interior hatching except the stipple shadow roles; one baseline per sheet. A plate failing it is rejected at the sheet step, never fixed in the cut.

Timing-chart vocabulary (frames at 30 fps, drawn on twos): a **key** is a drawn pose; a **breakdown** is an inbetween the chart places with a favouring (the fraction of the way from the earlier key, 1/3 or 2/3 by default, never 1/2 unless the move is a straight ease); a **hold** keeps a key with boil and light only; a **smear** is a one-frame breakdown on a move longer than a quarter of the figure's height. The chart is what the render study measures against (C23).

## Colour script per shot (D74)

**One hue pair and one emitter per shot over a palette per asset.** Each shot is a colour decision the way the owner's CalArts saves are: one or two saturated colours as whole fields, the figure a flat silhouette inside the light. The hue is the radiance under the assets and the accent is the one scarce mark (palette law `accent`); fills keep their five roles.

| Shot | Hue (radiance) | Accent | Emitter (shots.json) | Reference cards (board-06) |
|---|---|---|---|---|
| s01 arrival-overwhelm | `#0a51fb` Turrell blue | `#fad204` | box seam → gadget dial | Aten Reign blue; GIANT CRUSH gold field with figure in light; Hades blue flame |
| s02 cant-build-frame | `#17263a` Styx steel | `#457ca4` | gadget dial, lost → frame interior | The Styx boat; Lulu Mckown teal |
| s03 scaffold | `#e1750c` Eliasson amber | `#fad204` | the lit join of the moment | The Weather Project; Sweet on You yellow |
| s04 settle | `#a63a2e` Soup! coral | `#f8c496` | gadget, rimming the structure | Soup! ×2; Aten Reign violet as the refused alternative |

Travel between shots is a cut, or a morph that stays saturated on the chart (C15). A shot that needs a second hue has a second emitter, which C6 refuses; it is a second shot.

## Medium: two layers over a black field

| Layer | Owns | Implementation |
| --- | --- | --- |
| Field | black negative space; nothing is drawn where nothing matters | composition background token `field` |
| Flat assets | human, Codex, Clawd, six kit pieces, box, frame, gadget body | SVG components; every fill names a role, never a hex |
| Radiance | the gadget's light, motes, grain, lens flare, the frame's interior | one additive 2D canvas per shot, `lighter` composite, seeded by frame number |
| Kit beat | pieces joining and the workspace reshaping | Three.js scene inside `@remotion/three`, rendered with the ANGLE renderer, SwiftShader fallback |
| Frame interior | the environment seen through glass: refraction, diffusion, edge shift (D45) | the environment rendered to a texture, then a full-frame quad with a refraction shader, masked to the frame; same Three.js canvas as the kit beat |

Rules: one emitter per shot. The radiance layer never replaces a flat asset's shadow or light role; it adds over it. No wall-clock time and no unseeded random anywhere; a frame renders identically on every run.

## Palette law: five roles per asset

Each asset is drawn as a grayscale value pass first, then bound to five role slots, exactly as the board's sticker sheets show:

| Role | Meaning |
| --- | --- |
| `main1` | dominant local color |
| `main2` | second local color |
| `shadow` | one darker step of the mains, drawn as a designed shape: a form shadow following the silhouette plus a cast shadow on the field, weighted edge (D47); where it grades across a form it grades by dither or stipple density, never a smooth ramp (D48) |
| `light` | one lighter step, flat |
| `accent` | one small saturated mark, scarce |

A palette is a token map binding roles to colors. Identity pigments are separate from field pigments and are never graded: Codex blue and screen cyan, Clawd coral and dark eyes. Everything else may travel. Palette states are interpolated per role, keyed to beats; A-to-B is a token morph over unchanged drawings.

Provisional palette states, to be sampled against the board before any render is accepted:

| State | Field | Human and kit mains | Accent and emitter |
| --- | --- | --- | --- |
| Settled | black | saturated but few: two mains per asset, bold dark outline | one warm accent; emitter small and bounded |
| Overwhelm | black crowded by radiance | mains unchanged, radiance floods | accent everywhere, emitter at full; the painting's density |
| Scaffold | black returns | mains unchanged | one lit join at a time |

Exact hex values are chosen by sampling the board's sticker sheet and cloaked figures, not invented. They live in one token file in the Remotion package and nowhere else.

## Cast and objects

- Human: frozen B/C selection; redraw once as a layered SVG with role fills and a bold outline. Compact figure, swept hair, layered sleeveless outer shirt.
- Codex and Clawd: official identity cues preserved through the same outline and five-role treatment.
- Box: plain, flat, a container that reads as ordinary.
- Gadget: a hybrid contraption of familiar parts, riveted, improbable. Its body is a flat asset; its light is the radiance layer. It is the shot's emitter whenever it is present.
- Frame: a plain rectangle the companion holds up. Its interior is radiance, not a flat fill, so it reads as depth without end.
- Kit: the six pieces from [world-kit-01.png](studies/world-kit-01.png), simplified: ground patch, path segment, canopy, table, board, screen. Declared footprints, one join rule, human height as the unit.

## Story v2: the guided journey (D78, D79, provisional)

Thesis unchanged. The human is the user; the box is the server; the companions are the guides; the frame is the portal. Eight beats, 65 s, tracked beat by beat in [`beats-v2.json`](beats-v2.json) with actions, effects, transitions in and out, the state each beat flips and whether it flips back, the references, and the plot points still asked of the owner.

| # | Beat | World | s | Guide |
|---|---|---|---|---|
| 1 | Arrival | home | 6 | |
| 2 | Everything at once | home | 8 | |
| 3 | Can't build | home | 7 | |
| 4 | The frame; the cloak drops | home → portal | 6 | both |
| 5 | Art world: the human draws a piece and it becomes real | crayon | 12 | Clawd |
| 6 | Crossing: the world reduces to lines that re-route | line | 4 | Codex takes the lead |
| 7 | Programming world: the piece joins another, a gate lights, the chain runs | shaded | 12 | Codex |
| 8 | Home: the structure stands, the gadget rests inside | home | 10 | |

Plot defaults taken until the owner says otherwise: Clawd leads the art world and Codex the programming world (owner: yes); one action per world (draw a piece; join two pieces and light a gate); the human steps through the frame alone and the guides follow.

## Story: six silent beats (v1, the 40 s spine; superseded by Story v2 once the shots are rebuilt)

Thesis: raw capability is radiant and overwhelming; scaffolding is one lit join at a time.

| # | Beat | What is visible | Light and palette |
| --- | --- | --- | --- |
| 1 | Arrival | Black field. The project mark and title held top-left. The trio and a plain box; a thin light leaks at the box seam. The human opens it; the gadget rises. Frame 0 is the poster (D53). | Emitter is the box seam, tiny. Settled state. |
| 2 | Everything at once | The gadget projects every piece, structure and route around the trio. Joy, then too much. | Radiance floods; accent everywhere. Overwhelm state. |
| 3 | Can't build | The human grabs pieces; joins fail; a stack collapses. Companions wince. | Radiance goes noisy; grain up; no single emitter. |
| 4 | The frame | A companion holds up the frame. Through it, the whole assembled environment, refracted and diffused, someplace else (D45, D46). | Radiance narrows to the frame's interior; glass displaces and softens what lies behind. |
| 5 | Scaffold | Pieces join one at a time, each join a quiet accent pulse. The workspace takes shape. | Scaffold state; one lit join per moment. |
| 6 | Settle | The gadget rests, bright but bounded, inside the structure. The human is at ease. Title. | Settled state returns. |

Target 40 seconds at 30 fps. The first rendered proof is beats 4 to 5, six to ten seconds. Beat timing is a beats JSON that the composition reads; it is not fixed here.

## Animation language: drawn on twos, light on ones

The anti-reference is the early-web explainer video: every element tweening at once on a linear curve, hinge-jointed cutouts, pop-in text, no holds, no anticipation, motion with no cause. The film speaks a hybrid of three sources already on file, and the hybrid is defined by which layer each source governs.

| Layer | Governs | Source | Rule |
| --- | --- | --- | --- |
| Drawn layer: flat assets, contours, stipple | poses, gesture, line | The Midnight Gospel, Seuss gesture lines | moves on twos: a pose updates every 2–3 frames of the 30 fps timeline; contours boil between 2–3 seeded variants at about 4 changes per second; fast moves get a smear frame |
| Light layer: radiance, motes, glass, emitter | cause and consequence | CloudySky motion doctrine (force with memory), the cloaked-figure board | continuous on ones; every change has a cause, propagates with lag, and recovers without snapping: cause → light → glass → settle |
| World layer: kit pieces, frames, stalks | transformation | LCSlates tiles, Kevin Ngo material coherence | a piece transforms the way its material allows; a join is a seam pulse, never a fade; feedback marks belong to the drawing |
| Edit layer: shots, moves | progression | shfred ink composition, Seuss stalks and strings as leading lines | beats progress by morphs and camera moves along a leading line the world provides; the fewest cuts, each justified in its shot row (D64); a move has the same hold, anticipation, action, settle shape as an actor |

Timing vocabulary, in frames at 30 fps, used by every actor and by the motion prompt:

| Phase | Frames | Shape |
| --- | --- | --- |
| hold | 8–20 | nothing moves but boil and light |
| anticipation | 3–5 | small move opposite the action |
| action | 4–8, on twos | the move, with one smear frame if the distance is large |
| overshoot | 2–3 | past the target |
| settle | 10–16 | damped return, wobble decaying to the hold |

Laws:

1. One actor moves at a time. Related elements stagger by 3–5 frames; nothing is simultaneous unless it is one object.
2. No linear curve anywhere. The drawn layer eases by stepping through poses; the light layer eases by damped springs that remember the last impulse.
3. Boil is not shimmer. Boil alternates between fixed seeded variants at a low rate; shimmer is a per-frame reseed, and the rubric fails it (C13).
4. Light lags drawing. When the drawn layer acts, the radiance responds 2–4 frames later and the glass 2–4 frames after that; settle runs in the same order.
5. Motion exposes cause and recovery. Speed is never the identity of a move.
6. No text moves. The only text is the title, and it is held.

These rules are the contract the `showcase_motion` prompt will carry once encoded through the server (D49). Until then `src/library/motion.ts` is the executable form and the rubric rows C16–C18 are the check.

## Production: two chains

Authored through the isolated server (payloads 11–16, receipts under `evidence/call-*`), served from the worktree's resources, never hand-edited:

| Chain | Runs | Steps | Writes |
| --- | --- | --- | --- |
| `showcase_preproduction` | once per episode | `showcase_board` → `showcase_story` → `showcase_shotlist` → `showcase_review` (gate `showcase-review`) | `references/board.html`+`.png`, `beats.json`, `v3/shots.json` with the object inventory and one `>>showcase_asset_muse` command per object |
| `showcase_asset_muse` | once per object in the inventory | `design_muse` → `showcase_asset_sheet` (delegated) → `showcase_review` (gate) | the sheet still under `src/sheets/`, its receipt |
| `showcase_shot` | once per shot | `showcase_motion` → `showcase_render_study` (Remotion, or Blender via `tool:blender_render`) → `showcase_review` (gate) → `showcase_evidence` | `out/<shot>-f###.png`, `-strip.png`, `-probes.json`, `studies/<shot>-<pass>.md`, `shots.json.measured`, the beat's range in `script.md`, the plan's Now |

`showcase_shot` declares `budget.pauseOnBlocking: true`: a blocking unknown holds the run until a `gate_action` clears it. The chain is the D49 trail: a viewer runs `>>showcase_shot shot:"<id>"` on one beat.

## Library

`media/showcase/src/library/`: `tokens.ts` (roles, palette states, `lerpPalette`), `Sprite.tsx` (applies a palette as CSS variables to a role-filled SVG), `Radiance.tsx` (seeded additive canvas), `kit/` (six pieces with footprints), `cast/` (three figures as layered SVG), `motion.ts` (hold, anticipate, act on twos, overshoot, settle, stagger, boil, lag; the animation language as functions). Feature demos are later compositions that take an MCP receipt JSON from `media/showcase/evidence/` as props and reuse the same library.

The board. `references/board.json` is the bible at a glance: every reference as a card with what it borrows, what it refuses and the rulings and rubric rows it governs, grouped by the layer it informs, with the five roles, identity pigments, timing table, motion laws and anti-references at the top. Our own iterations never appear on it (D56). Section 6, Lineage, carries the seven v2 references that survived the medium change as properties, each naming the law it became; the rest of v2 stays filed under `v2/` and is not inspiration. `npm run board` renders it as `references/board.html` (clickable; local study copies of every video play at their timestamp) and `references/board.png` (the glance). A new ruling adds a card; a muse sheet cites card ids. Study: [board-01](studies/board-01.md).

## Renderer and machine (measured 2026-10-07)

An RTX 3090 is paravirtualized into this WSL2 instance and Mesa's d3d12 driver is installed, but neither Remotion's managed headless shell nor system Chrome 151 can create a WebGL context through any GPU backend Remotion exposes (`angle`, `angle-egl`, `vulkan`); the headless shell reports zero EGL display types. `swangle` (SwiftShader on ANGLE) is the only working backend, ~4.5 s per 1280x720 frame. Proofs render here; a full film render belongs on the Windows host, where ANGLE uses D3D11 natively, or on a GPU box. Pinned in `remotion.config.ts`.

## Open

- Token values: resampled 2026-10-07 from the Seuss paintings (owner ruling); reviewed on beat4-seuss-06; still provisional for this test demo.
- Resolved by D45 on beat4-still-01: the 2D canvas reads as a flat picture; the frame interior is a GPU pass.
- The seven-beat gate-authoring outline in `docs/portfolio/showcase-script.md` is retired as the film's story and kept as the shape of later feature demos.

## Evidence boundary

Reference properties transfer; no figure, character or composition from the board or from Mind Game is copied. Generated or rendered output is accepted only after being opened and reviewed; no numeric art score exists. The v2 episode and the v3 boards remain controls.
