# Showcase grading rubric

Version 1.9 · 2026-10-14 · owned by the planner, ruled by the owner. Every study receipt under `studies/` grades against this file by criterion id. A grade without a named criterion is an opinion, not a grade.

## How a pass is graded

Each criterion gets one of four marks, always with the evidence that produced it:

| Mark | Meaning |
| --- | --- |
| HOLDS | the property is visible in the cited evidence and a named failing control would not pass |
| FAILS | the property is absent or wrong in the cited evidence; the receipt names what to change |
| UNPROVEN | the evidence cannot show it (a still cannot show motion; a 3x crop cannot show composition) |
| TASTE | mechanically correct, but whether it is right is the owner's call; the receipt asks one question with a default |

Evidence tiers, weakest to strongest: prose · still · 3x crop · consecutive frames · moving render · owner viewing. A criterion's row names the weakest tier that can prove it. Grades above that tier are allowed; grades below it are UNPROVEN.

## Criteria

| Id | Criterion | Ruling | Minimum evidence | Failing control |
| --- | --- | --- | --- | --- |
| C1 | Identity pigments unchanged across every state and layer | D35, D36, palette law | still, sampled pixel | beat4-still-01 first render: Clawd washed pink by additive light on top |
| C2 | Every asset fill names a role; palette change touches no asset file | D44, five-role law | `git diff --stat` after a token change | a hex literal inside an asset SVG |
| C3 | Shadows are designed shapes: form shadow follows the silhouette, cast shadow on the field | D47 | 3x crop | beat4-still-01: flat lower band |
| C4 | Shadow gradients grade by two-scale stipple with a hue shift toward cool at contact | D48, Midnight Gospel refs | 3x crop | beat4-dither-03: single-scale fine grain |
| C5 | Black field reads as negative space; nothing drawn where nothing matters | D44 | still | palette-light-01: scenic fill everywhere |
| C6 | One emitter per shot; radiance sits under flat assets and adds over them | medium rule | still | two glows competing, or glow over an identity pigment |
| C7 | Frame interior reads as someplace else: refraction, diffusion, edge shift, drawn depth | D42, D45 | still, then moving | beat4-still-01: flat gradient "png" |
| C8 | Architecture follows the Seuss grammar: swooping silhouettes, pale contours, receding turned frames, stalks, beaded light | D50 | still | beat4-glass-02: grey boxes |
| C9 | Grain is subordinate: texture never dissolves an outline | D48 | 3x crop | beat4-gospel-04: sandpapered interior |
| C10 | Composition hierarchy: the frame interior is the shot's subject; towers, stalks and gadget support it | D46 | full still | beat4-seuss-05: towers blocking the tunnel |
| C11 | Gadget reads as familiar parts in an impossible whole, in the same contour language as the world | D43, D50 | 3x crop | a device with buttons, or an orb |
| C12 | Frame renders byte-identical across two runs | medium rule | sha256 of two renders | any wall-clock or unseeded random |
| C13 | Motion: glass warp, stipple and motes move slowly and never shimmer | D48, medium rule | consecutive frames or moving render | dither re-seeded per frame |
| C14 | Acting: turn, reach, contact, settle read without text | story | moving render | fixed palm, plane shear |
| C15 | Palette travel never dips to grey or detours in hue between two states | CloudySky contract 4, D44 | mid-morph still | beat4-seuss-07 frame 60: grey leaf |
| C16 | Drawn layer moves on twos with hold, anticipation, action, overshoot, settle; no linear tween | D51 | consecutive frames | an element whose position changes by an equal step every frame |
| C17 | One actor at a time; related elements stagger by 3–5 frames | D51 | moving render | two unrelated elements starting on the same frame |
| C18 | Light lags drawing by 2–4 frames and recovers without snapping; a join is a seam pulse, not a fade | D51, CloudySky 6.4 | consecutive frames | radiance that changes on the same frame as the pose, or an opacity fade |
| C19 | An asset enters a scene only after a muse sheet: 3+ rendered variants in the substrate, each citing reference properties and one existing cast property, with the pick named and the losers kept as controls | D55 | the sheet still plus its receipt | beat1-11 human: first draw, no sheet, no cited property |
| C20 | Keys match the model sheet: head count and limb lengths within 5 %, construction volumes agree | D72 | key sheet overlaid on the model sheet | human-gen-18 parts: a second generation at its own scale |
| C21 | Keys carry the acting: one line of action per key and a silhouette that reads filled black | D72 | silhouette fill of each key | puppet-proof-02: a rotation-only lift with no line of action |
| C22 | Clean-up standard met on the plate: contour equal to the approved model sheet's measured line (`model.json` `contour.ratio`, D76) ± 20 % at the same figure height, tapered tips, closed shapes, pale contour per role | D72 | 3x crop plus the measured weight | rig-sheet-02 hard column |
| C23 | The timing chart is followed: breakdowns sit at their favouring along the chord (an arc leaves the chord by design, C32), holds hold or drift as declared (C33), moves step on twos | D72 | consecutive frames measured against the chart | beats45-08: timed without a chart |
| C24 | Every frame of a shot sits inside its D74 hue pair: sampled radiance hue within 15° of the shot's hue, accent within 15° of its accent, no third saturated hue outside identity pigments | D74 | hue histogram of the frame minus identity-pigment pixels | a Hercules-blue overwhelm frame with an amber join in the same shot |
| C25 | The render matches the shot's cinematography sheet: figure on-screen height within 5 % of the layout's, emitter within 3 % of frame width of its layout position, the move's start and end framings as drawn | D77 | layout.json vs rendered frames at move start and end | a key sheet drawn at a wider camera than the layout, so the figure shrinks in the render |
| C26 | Timeline conformance: each beat holds the screen for the frames the timeline gives it (within 1 frame at each end), in its world, with every crossing window inside both beats | D81 | frame sequence + xsheet | `probe-screentime.py` control: `make.shifted_timeline` moves beat b 3 frames against the unshifted xsheet |
| C27 | Twos/ones split: the drawn layer changes only on even frames outside crossings, while the camera may change on every frame | D81 | frame sequence + xsheet | `probe-twos.py` control: `make.twos_sequence(bad=True)`, a figure change on frame 7 under a camera panning every frame |
| C28 | Hold band: every hold lasts 11-27 frames unless the xsheet declares a key hold of 28 or more, and a move between holds uses 3-6 drawings | D81 | frame sequence + xsheet | `probe-holds.py` control: `make.holds_sequence('hold40')`, a 40-frame hold with no declared key |
| C29 | Eye trace: the brightest 0.5 % of the non-identity pixels sit within 3 % of the frame width of the xsheet emitter | D81 | frame sequence + xsheet | `probe-eyetrace.py` control: `make.eye_sequence(10.0)`, the bright blob 10 % of the width off the emitter |
| C30 | Colour continuity across crossings: every frame inside its beat's hue pair, and the dominant hue moves monotonically from the from-beat's pair to the to-beat's | D81, D74, C15 | frame sequence + xsheet | `probe-colour.py` control: `make.colour_sequence(path='detour')`, a crossing that swings through green, and `patch_frames`, an off-pair magenta patch |
| C31 | Line of action: every key's spine fits the curve class the pose sheet declares (C, S or straight) with a bow of at least 6 % of the figure's height; limb pairs do not twin unless the pose says why; a weight foot is declared and the root sits over it | D83, C21 | pose sheet + key sheet joints | `probe-poses.py` control: a straight spine declared S and mirrored limbs with no why are each refused |
| C32 | Arcs and spacing: on a move, the lead wrist, the head and the root travel on arcs off the chord and the drawings ease in and out of the keys; a straight path or even spacing on a long move fails | D83, C16 | joints dump + figure frames | `probe-inbetweens.py` control: a linear lerp between two keys (straight chord, even spacing) is refused |
| C33 | Overlap and moving holds: a declared secondary (poncho, hair, hands) lands one to three drawings after the primary; a hold over 11 frames drifts a few pixels or changes a face state, never freezes | D83, C16 | joints dump + figure frames | `probe-inbetweens.py` control: a secondary snapped to the primary's frame and a frozen 26-frame hold are each refused |

## Receipt shape

Every study receipt has five parts, in this order, so two receipts can be read side by side:

1. **Changed**: what this pass altered, by file.
2. **Grades**: one line per criterion touched, `Cn HOLDS|FAILS|UNPROVEN|TASTE — evidence — note`. Criteria not touched are omitted, not implied.
3. **Controls**: which earlier study is the failing control for each FAILS that flipped to HOLDS.
4. **Owner**: at most two TASTE questions, each with a default the planner will take if unanswered.
5. **Next**: the fixes for every FAILS, as one list.

## Evolution

This rubric changes in three ways, each recorded in the log below:

- A new owner ruling names a property → a criterion row is added with that ruling and a failing control from an existing study.
- A criterion HOLDS for three consecutive passes → it moves to a "baked" list and is checked only when its files change.
- A criterion keeps grading TASTE → the owner either rules it (it becomes HOLDS/FAILS) or it is deleted as not a criterion.

The same rows are the draft for a `showcase-review` gate authored through `resource_manager` once the moving proof is accepted (D49: the server-scaffolded chain is the trail). Until then this file is the gate.

### Log

- v1.4, 2026-10-13: C20–C23 added from the craft baseline (D72: model sheet, keys, clean-up, timing chart); failing controls are the parts-sheet generation, puppet-proof-02, rig-sheet-02's hard column and beats45-08.
v1.5, 2026-10-13: C24 (colour script per shot, D74)
v1.6, 2026-10-13: C22 re-based to the approved model sheet's own line (D76)
v1.7, 2026-10-13: C25 (cinematography sheet followed, D77)
v1.8, 2026-10-14: C26-C30 added for the episode tier (D81): timeline conformance, twos/ones split, hold band, eye trace, colour continuity across crossings; each is proved by a probe script under scripts/animation/ with a positive control
- v1.9, 2026-10-14: C31–C33 added for the pose pass (D83): line of action per key, arcs and spacing on moves, overlap and moving holds; proved by `probe-poses.py` and `probe-inbetweens.py` with positive controls

- v1, 2026-10-07: fourteen criteria from rulings D35–D50 and studies 01–06.
- v1.3, 2026-10-07: C19 added (asset muse, D55); the human in beat1-11 is its failing control.
- v1.2, 2026-10-07: C16–C18 added from the animation language (D51 proposed).
- v1.1, 2026-10-07: C15 added from the grey-leaf finding in study 07; C12 and C13 (stipple) first HOLDS.
