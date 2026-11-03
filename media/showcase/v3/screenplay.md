<!-- generated from screenplay.json by scripts/animation/compile-screenplay.mjs · source dd2a98f0d3c5 · body fc75ae0d5b4d -->
> Generated from `v3/screenplay.json` by `npm run screenplay`. Edit the json, never this file.

# Claude Prompts: screenplay

Revision 1 · 2026-10-19 · director's draft for the owner (p014)

**Logline.** A user opens a box that is too bright to use, and two companions walk them through the frame that makes it usable, one lit join at a time.

**Thesis.** Raw capability is radiant and overwhelming; scaffolding is one lit join at a time.

## Colour strip

blue (sp-1.1–sp-2.3) → steel (sp-3.1–sp-4.5) → steel → crayon (sp-4.6) → crayon (sp-5.1–sp-5.4) → line (sp-6.1–sp-6.2) → shaded (sp-7.1–sp-7.3) → shaded → coral (sp-7.4) → coral (sp-8.1–sp-8.3)

| Key | Name | Hue / accent |
| --- | --- | --- |
| blue | Turrell blue | #0a51fb / #fad204 |
| steel | Styx steel | #17263a / #457ca4 |
| crayon | art world kit (world-kit-01) | crayon kit on paper |
| line | crossing, pale contour lines | line kit on black |
| shaded | programming world kit, emissive edges | shaded kit on black |
| coral | Soup! coral | #a63a2e / #f8c496 |

## Themes

What the film keeps true from beat to beat. A probe reads each one: `probe-screenplay.py` the tags and the channels, `probe-theme.py` the staging.

| Theme | What it says | Carried by | Measured by |
| --- | --- | --- | --- |
| th-glass · capability is always seen through glass | the gadget is visible only inside the bubble or the frame interior; outside both it is lost in grain (beat 3) or resting inside the structure (beat 8); the one stretch it stands free is sp-2.1 to sp-3.1, the overwhelm after the pop (script.md bubble (D45), beats-v2 the-frame) | sp-1.3, sp-2.1, sp-3.3, sp-4.2, sp-8.1 | blocking: on every frame where gadget is on, bubble or frame or structure contains its anchor |
| th-one-join · scaffolding is one lit join at a time | after sp-4.6 no story point lights more than one new join, and the flood (sp-2.2 to sp-2.3) is the only place where arrivals are not staggered; the strokes of one drawing (sp-5.2) are one piece, not three joins (thesis; script.md beat 5) | sp-2.2, sp-2.3, sp-3.1, sp-5.2, sp-5.3, sp-6.2, sp-7.2, sp-7.3 | blocking: joins.lit rises by at most 1 per story point in beats 5-8; arrivals staggered >= 3 frames outside sp-2.3 |
| th-light-leads · light leads composition | every story point names what its light pushes and the eye finds it (D91) | sp-1.1, sp-1.2, sp-1.3, sp-2.1, sp-2.2, sp-2.3, sp-4.2, sp-4.6, sp-5.3, sp-6.1, sp-7.1, sp-7.2, sp-8.3 | screenplay: eye or emitter on every story point; probe-eyetrace target resolves |
| th-channels · the human is eyes, Clawd is heart, Codex is humour | in each act (beats 1-3, beat 4, beats 5-8) at least one story point carries the human's look, one Clawd's touch, one Codex's gag (D89) | sp-1.2, sp-1.3, sp-2.3, sp-3.1, sp-3.2, sp-3.3, sp-4.2, sp-4.3, sp-4.4, sp-4.5, sp-5.1, sp-5.2, sp-6.2, sp-7.1, sp-7.3, sp-8.2 | screenplay: channels field per story point, each act covers eyes, heart, humour |
| th-child-detail · details only a child would notice | every beat carries at least one small persistent detail (the heap that stays, the heel tap, the lid, the hands appearing, the tape on the box) (D92 (Ghibli, totoro-lived-in, spirited-away-shoes)) | sp-1.1, sp-1.2, sp-4.3, sp-4.4, sp-4.5, sp-5.4, sp-8.1 | screenplay: each beat has a story point tagged th-child-detail whose after key or prop persists past the story point |
| th-register · warm, playful, inviting; reverent only at beats 4 and 8 | registers outside beats 4 and 8 are warm, playful, inviting, curious, delighted or overwhelmed; reverent appears only in beats 4 and 8 (D88) | sp-1.1, sp-2.2, sp-3.2, sp-4.1, sp-4.5, sp-5.1, sp-8.1, sp-8.2, sp-8.3 | screenplay: register per story point against the beat |
| th-frame-portal · the frame is the portal: carried in at sp-4.2, never on stage before | the frame prop is absent from every frame before sp-4.2 and present from sp-4.2 to the end (beats-v2 the-frame; D99) | sp-4.2, sp-4.6, sp-7.4, sp-8.3 | blocking: frame on >= 690 only; present through 1950 |

## 1. EXT. HOME FIELD - ARRIVAL · frames 0–180

### s01/sp-1.1 · SETTLED · f0 · blue · warm, inviting

A closed box. The only light is the seam of its lid. The human stands behind it in the heavy cloak, hands hidden in the sleeves. Codex left, Clawd right, both still.

- wants: to know what is inside
- turn: nothing yet: the seam asks
- sees: poster frame; one emitter; three silhouettes and a box
- measure: lid angle 0; cloak covers both hands; emitter count 1
- themes: th-register, th-child-detail, th-light-leads

### s01/sp-1.2 · LIFT · f60 · blue · curiosity

The human lifts the lid in one move. The sleeves slide back: the first time we see hands. The seam light lags behind the lid, then spills.

- wants: open it
- turn: the box opens
- sees: the lid rises; two hands appear; the light widens a beat late
- measure: lid angle from 0 to open; hands visible after, not before; light area grows after the lid, lag ≥ 4 frames
- themes: th-child-detail, th-channels, th-light-leads
- channels: eyes

### s01/sp-1.3 · SWELL · f110 · blue · curiosity

A glass bubble swells out of the box with the gadget dim inside it. Codex, then Clawd, lean in, staggered by four.

- wants: see
- turn: capability appears, behind glass
- sees: a bubble grows over 40 frames; two heads tilt toward it one after the other
- measure: bubble appears out of the box; gadget present inside; codex lean precedes clawd lean by 4
- themes: th-glass, th-channels, th-light-leads
- channels: eyes
- texture: bubble radius grows (the blocking has no scale key on a prop)

## 2. EXT. HOME FIELD - EVERYTHING AT ONCE · frames 180–420

### s01/sp-2.1 · POP · f186 · blue · delight

The bubble pops. One frame of smear. The light arrives first, the glass second: the gadget stands free with its dial wide.

- turn: the glass is gone; nothing bounds it
- sees: the bubble vanishes; the whole field goes blue
- measure: bubble absent after; field hue area jumps
- themes: th-glass, th-light-leads

### s01/sp-2.2 · FLOOD · f230 · blue · delight

The gadget projects: stalks shoot up, arches drop in, rings spin out, patches tile, beads scatter, each on twos, staggered. The human turns with joy, arms open: the one full arm-open in the film, and it is earned.

- wants: all of it
- turn: delight
- sees: pieces arrive one after another around the trio; the human spins once
- measure: piece count rises from 0; arrivals staggered ≥ 3 frames until sp-2.3
- themes: th-one-join, th-register, th-light-leads
- texture: human turns ≥ 90° (no layer reads the figure's facing)

### s01/sp-2.3 · TOO MUCH · f330 · blue · overwhelm

Nothing is staggered any more; everything arrives at once. Codex catches a piece out of the air. A stalk shoves Clawd sideways. The human pulls the cloak back around and shrinks.

- wants: make it stop
- turn: delight tips to overwhelm
- sees: the human gets smaller in the frame as the pieces get bigger; Clawd is displaced; Codex holds a piece
- measure: human silhouette height falls ≥ 15 %; clawd x moves ≥ 40 px; codex holds a prop; ≥ 6 arrivals on one frame
- themes: th-one-join, th-channels, th-light-leads
- channels: heart, humour

## 3. EXT. HOME FIELD - CANT BUILD · frames 420–630

### s02/sp-3.1 · REACH · f430 · steel · frustration kept kind

The human reaches for a stalk to plant it on a patch. Anticipation, action, contact: no pulse. The stalk slides back the way it came.

- wants: build something
- turn: the join refuses
- sees: a hand closes on a stalk; the stalk returns to where it was
- measure: hand reaches stalk (contact); stalk returns to its start within 20 frames; no seam pulse
- themes: th-one-join, th-channels
- channels: eyes

### s02/sp-3.2 · STACK · f500 · steel · gentle gag

Both hands now. The human stacks three patches. They collapse, staggered by three, each a settle with no hold. Codex winces small at frame left.

- wants: build anything
- turn: it falls
- sees: three pieces go up, three come down
- measure: three props rise then fall; falls staggered 3; codex holds still
- themes: th-channels, th-register
- channels: humour
- texture: codex boil variant held (a boil variant is the renderer's, no layer records it)

### s02/sp-3.3 · LOST · f580 · steel · frustration kept kind

The dial's light is lost in the grain. The human sits down in the mess. Clawd looks at the human, then leaves frame right.

- turn: Clawd decides something
- sees: grain up; the human low; Clawd exits
- measure: grain high; human height at its lowest; clawd absent from frame after
- themes: th-glass, th-channels
- channels: heart

## 4. EXT. HOME FIELD / PORTAL - THE FRAME · frames 630–930

### s02/sp-4.1 · SLUMP · f630 · steel · reverent

Hold. The human slumped among the fallen pieces, the cloak pooled. Codex small at left. Clawd gone.

- sees: stillness in the mess
- measure: hold 26; no prop moves
- themes: th-register

### s02/sp-4.2 · TURN · f690 · steel · wonder

Clawd re-enters from the right holding the frame up with both arms. Its interior lights: the crayon world is inside it, refracted. The human's head turns to it first, then the body.

- wants: to see what that is
- turn: a bounded light appears
- sees: Clawd carries a lit rectangle in; the human turns
- measure: frame prop enters; emitter sits inside the frame interior
- themes: th-frame-portal, th-glass, th-channels, th-light-leads
- channels: heart, eyes
- texture: frame interior is the brightest region (probe-eyetrace reads it on the frames); human head turn precedes torso by ≥ 4 (no layer records the head and the torso apart)

### s02/sp-4.3 · RISE · f740 · steel · wonder

The human rises. The cloak slides off and falls to a heap that stays. The Swoop is revealed hands first.

- wants: go to it
- turn: the heavy thing comes off
- sees: a dark heap on the floor that was not there; a lighter figure
- measure: heap prop on the floor after, absent before; figure silhouette changes garment; heap stays to 1950
- themes: th-child-detail, th-channels
- channels: eyes

### s02/sp-4.4 · STEP · f800 · steel · comic

The human steps toward the frame. Codex, passing, nudges the heap with a foot. It does not move much. That is the gag.

- sees: a step; a small kick; the heap shifts a little
- measure: human x moves toward frame ≥ 60 px; codex contact with heap; heap displacement 4–12 px
- themes: th-channels, th-child-detail
- channels: humour

### s02/sp-4.5 · THRESHOLD · f840 · steel · reverent

At the frame. One hand on its edge. The heel taps the floor at its base and settles. The human looks through.

- wants: to go through
- turn: a choice
- sees: contact with the frame; a heel tap
- measure: hand within 8 px of frame edge; hold 24
- themes: th-child-detail, th-channels, th-register
- channels: eyes
- texture: heel contact 828 settles 836 (no layer records the heel)

### s02/sp-4.6 · THROUGH · f900 · steel → crayon · wonder

The human steps through. The field narrows to the frame; everything outside it dims through the lag. Codex and Clawd follow.

- turn: the world changes
- sees: the figure crosses the frame's plane; the outside goes dark
- measure: human crosses frame x; outside luminance falls ≥ 50 %; the field is paper by the crossing's end
- themes: th-frame-portal, th-light-leads

## 5. EXT. CRAYON PAPER - ART WORLD · frames 930–1230

### s03/sp-5.1 · PAPER · f940 · crayon · playful

A paper field. Crayon architecture: stacked arches as scribbles, stalks as waxy lines. Clawd hands the human a crayon.

- turn: a tool is given
- sees: white paper; a crayon changes hands
- measure: field is paper; the crayon passes from Clawd's hand to the human's
- themes: th-channels, th-register
- channels: heart

### s03/sp-5.2 · DRAW · f1010 · crayon · playful

The human draws a stalk in the air in three strokes. The strokes stay where they are drawn.

- wants: make one thing
- sees: three lines appear one after another in the air
- measure: three stroke props appear in order; each stroke staggered ≥ 6
- themes: th-one-join, th-channels
- channels: eyes

### s03/sp-5.3 · REAL · f1110 · crayon · delight

The drawing fills in and becomes a real stalk; its leaf opens. Codex keeps it from drifting off with one hand.

- turn: a drawing becomes a thing
- sees: line becomes fill; a leaf opens; Codex steadies it
- measure: stroke props replaced by a stalk prop; codex contact with stalk
- themes: th-one-join, th-light-leads
- texture: leaf opens over ≥ 8 frames (no layer records a leaf)

### s03/sp-5.4 · CARRY · f1200 · crayon · curiosity

The human picks the stalk up and holds it like a lantern. Turns toward the edge of the paper, where the lines begin.

- wants: take it somewhere
- sees: the piece in hand; a turn to the edge
- measure: stalk prop attached to the human's hand
- themes: th-child-detail
- texture: human faces frame right (no layer records the facing)

## 6. EXT. LINE WORLD - CROSSING · frames 1230–1350

### s03/sp-6.1 · REDUCE · f1240 · line · focused

Everything reduces to pale contour lines, the figures included.

- sees: fills drain; only lines
- measure: fill area falls ≥ 50 % from the reduce's start
- themes: th-light-leads
- texture: figure drawn as line (the line figure is a render of its own, `animatic-figline-seq`, with no layer to compare it to)

### s03/sp-6.2 · RE-ROUTE · f1300 · line · focused

The lines re-route and connect: the stalk's lines reach the next world's grid. Codex steps past Clawd and takes the lead.

- turn: the guide changes
- sees: lines rewire; Codex passes Clawd
- measure: codex x passes clawd x
- themes: th-channels, th-one-join
- channels: humour
- texture: piece lines connect to grid (the pieces' lines and the grid are not in the blocking)

## 7. EXT. SHADED GRID - PROGRAMMING WORLD · frames 1350–1650

### s03/sp-7.1 · GRID · f1360 · shaded · focused

Shaded architecture with emissive edges. Gates as rings. Codex points to one empty join.

- turn: a place to put it
- sees: a dark grid with lit edges; a pointing arm
- measure: field shaded
- themes: th-channels, th-light-leads
- channels: humour
- texture: codex points (arm extended) at the join prop (no layer records Codex's arm)

### s03/sp-7.2 · JOIN · f1440 · shaded · satisfaction

The human places the stalk against another piece. Contact. The join lights: a seam pulse at the keystone, the first one that has worked.

- wants: make it hold
- turn: it holds
- sees: a piece set down; a pulse
- measure: stalk prop contact with the join; seam pulse; join emitter lit after
- themes: th-one-join, th-light-leads
- texture: the seam pulse follows the contact by ≥ 4 frames

### s03/sp-7.3 · RUN · f1520 · shaded · satisfaction

The chain runs down the grid: three gates light in sequence, the third is the one the human made. Clawd watches from the edge.

- turn: the thing works
- sees: three rings light one after another
- measure: three gate props lit in order, staggered ≥ 8
- themes: th-one-join, th-channels
- channels: heart
- texture: the third is the human's (no layer records whose gate it is)

### s03/sp-7.4 · RETURN · f1620 · shaded → coral · contentment

The frame stands ahead, now a window with home inside it. The trio steps back through.

- sees: the frame as a window; three figures cross it
- measure: frame prop present
- themes: th-frame-portal
- texture: three figures cross its x (the human's crossing is read at sp-4.6; Codex and Clawd's are not recorded for this beat)

## 8. EXT. HOME FIELD - HOME SETTLE · frames 1650–1950

### s04/sp-8.1 · STAND · f1660 · coral · contentment

Home. The structure stands small under the frame (D102) with the crayon piece and the lit joins inside it. The gadget rests inside, bright but bounded.

- sees: a built thing where the mess was; the heap still on the floor
- measure: structure prop present; gadget inside its bounds; heap prop still present; pieces outside the structure ≤ 2
- themes: th-glass, th-child-detail, th-register

### s04/sp-8.2 · SETTLE · f1760 · coral · settled

The human sits on the patch. Codex settles left, Clawd right, each with one idle boil. The frame is set down against the structure.

- wants: rest
- sees: three figures come to rest; the frame leans
- measure: human height falls to seated; codex and clawd hold still; frame prop at rest against structure
- themes: th-channels, th-register
- channels: heart, humour
- texture: codex and clawd each hold 1 boil variant (a boil variant is the renderer's)

### s04/sp-8.3 · WINDOW · f1860 · coral · settled

One last look through the frame, now a window. Title. Hold to the end.

- sees: a held picture; the title
- measure: hold ≥ 60; title mark visible
- themes: th-frame-portal, th-register, th-light-leads
- texture: frame 1949 is the second poster (the poster is a still the pipeline takes, not a frame of the film)

## Asks

- ask-5 (sp-5.2): which object the human draws first. Default: the first stalk.
- ask-7 (sp-7.3): how many gates light. Default: three, the third is the one the human made.
- ask-c (sp-5.1): the world kits carry their own hue pairs; does the colour script gain three rows (crayon, line, shaded) or do the worlds keep the kit palettes as they are. Default: three rows, taken from the kit studies.
