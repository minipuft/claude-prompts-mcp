# Beats 1 and 2 restaged and acting on their six story points (2026-10-19)

The owner has not watched this. It is the first slice of plan row 9.6 (`plans/animation-scaffold-2026-10-14.md`): the arrival (frames 0-180) and everything-at-once (180-420) now stage the six story points of `v3/screenplay.json`, sp-1.1 to sp-2.3, so that `probe-story.py` passes all six and the eye trace holds on the whole shot. The renders, probes and strips below were made by hand with the commands the chain's gates run, and each is labelled as such. The frame sequences are `out/animatic-06-draft-seq` (composed, 1950 frames at 1280 x 720), `-fig-seq` (the human alone), `-figline-seq` and `-seq-b` (every tenth frame again); the half-size video was not rendered, because the box was at load 60 with another worker's render beside it and the render could not finish (see "What is open").

![the six story points of beats 1 and 2, before (animatic 05 draft) on the upper tile of each pair and after on the lower](beats12-restage/beats12-six-story-points-before-after.png)

<details><summary>Codes used below</summary>
D-numbers are owner rulings (`v3/creative-spec.md`); p-numbers are proposals on the bible page (`v3/proposals/`); sp-numbers are story points of `v3/screenplay.json`. A "key" is a drawing the human holds; a "hold" is a drawing left on screen; "stage pixels" are the 1280 x 720 picture. The strip shows frames 0, 66, 150, 192, 260 and 340, each inside its story point.
</details>

## What the viewer sees now

- **Settled, 0.** A closed box stands close beside her (it stood far to her right and was drawn half open). One light, at the box's seam. Codex far left, Clawd right, both still.
- **Lift, 60.** Her lifting key lands on 60, and the lid goes with it: shut until 54, 24 degrees open on 60, wide open (105 degrees) by 72. The lid is a prop now, with position keys, so it opens on the frames its keys say.
- **Swell, 110.** A glass bubble comes out of the open box on 110 and swells over the next 40 frames (a radius of 19 px on 110, 56 on 130, 93 on 150) while it rises; the gadget is inside it from 138. Codex starts to lean in on 106 (a step toward the box), Clawd four frames later, on 110. Her `awe` key lands on 110.
- **Pop, 186.** The bubble is gone on 190 (inside the story point's 186-229) and the gadget drops onto the kit's blocks by 196. Her `joy-a` key lands on 190.
- **Flood, 230.** The pieces arrive one after another: the stalk on 232 and the arch on 244, twelve frames apart, so the count goes from 0 to 2 by 329. She turns: her hips flip half a turn from 190 to 228 and half a turn again from 228 to 266, one full spin, then fold in (flinch, 300).
- **Too much, 330.** Her `shrink` key lands on 330. The ring, the patch (four blocks) and the bead (fifteen beads) all arrive on 330; the ring comes down into Codex's hands by 338; a stalk shoves Clawd 58 px to the left between 334 and 346. The brightest place in the picture is the gadget's lamp, which now stands between her and Clawd, so the eye finds the trio on 230-329 and her on 330-419.

## The six story points, before and after (`probe-story.py`)

Before is `out/animatic-05-draft-story.txt` (the render the previous slice left); after is `out/animatic-06-draft-story.txt`, the same command on the new frames.

| Story point | Before | After |
| --- | --- | --- |
| sp-1.1 SETTLED | pass | pass |
| sp-1.2 LIFT | FAIL: `key 'lift' is bound but at f66, 6 frames from the story point`; `'box' ... nothing outside the figure changes within 150 px of it (21 px against 600)`; `world: ... nothing differs` | pass: `key 'lift' at f60`; `'box' present, 6175 px change within 150 px of (895, 450)`; `props layer 6487 px` |
| sp-1.3 SWELL | FAIL: `key 'awe' is bound but at f104, 6 frames` | pass: `key 'awe' at f110`; `'gadget' appears, 8196 px change within 150 px of (905, 312)`; `records: box goes, bubble appears, gadget appears, lid goes, codex moves 24 px, clawd moves 22 px` |
| sp-2.1 POP | FAIL: `'bubble' is already gone before the story point (not in the blocking at f185)`; `world: ... nothing differs` | pass: `'bubble' disappears, 2552 px change within 150 px of (905, 285)` |
| sp-2.2 FLOOD | FAIL: `stalk/arch/ring/patch/bead count is 1 at f229 and 1 at f329`; `world: ... nothing differs` | pass: `count 0 -> 2`; `records: arch appears, stalk appears` |
| sp-2.3 TOO MUCH | FAIL: `key 'shrink' is bound but at f272, 58 frames from the story point` | pass: `key 'shrink' at f330` (and see the next section for what `human.small` really reads) |

The whole film reads `FAIL: story - 16 of 29 checks failed`, down from 21, and the 16 are the story points outside beats 1 and 2 that failed before.

**The eye trace, on 0-419** (`probe-eyetrace.py ... --shot s01-arrival-overwhelm`, with the five table rows below added in memory): before, `190 frame(s) over 3 % of the width` on 230-419 (7.6 % to 17.0 % off, worst at 418); after, `0 frame(s) over 3 % of the width`, 418 frames measured (`{'emitter': 228, 'human': 90, 'trio': 100}`), worst 1.2 % at frame 55. The light moved, not the eye line: the lamp stood about 100 px from the nearest of the three cast crops; the box, bubble, gadget and lamp now stand 145 px nearer the human, between her crop and Clawd's: 25 px from hers and 61 px from Clawd's.

## How each part was made

**Her keys moved to the story points' frames.** `lift` 66 to 60, `awe` 104 to 110, `shrink` 272 to 330 (prefer moving the key, the row said, and none of the three story points moved). Everything that holds her drawings moved with them, in the pose sheet, the key sheet and the chart (`out/b12/retime.py` reads the originals in `out/b12/orig` and writes all three): the moves between keys keep 3 to 6 drawings of at most 4 frames each, the authored in-betweens keep their joints (their key hashes did not change), and `grip` moved to 38 so the lift has its 6 frames. Two keys were added so she has something to do between the spin of 190-248 and the fold of 330: `joy-c` (266, a copy of `joy-a`'s drawing, which closes the spin) and `flinch` (300, a copy of `brace`'s drawing, the first tightening); the three new moves are authored with `author-breakdowns.mjs`. `probe-poses` and `probe-all --contract` pass on the new sheet. The two copies have no plates of their own (their key-sheet entries say so); `npm run plates` would build them.

**The staging.** `out/b12/stage.py` writes the two blocking files from the originals. The box, its lid, the bubble and the gadget stand at x 895 to 905 (they stood at 1040): that is the one move that turns the eye trace green, and it also brings the box to her reach, which on 66 and 110 now meets it (it stopped 75 px short on 66). Clawd stands at 1010 (988 after he leans), the frame's rectangle moved to the top right corner so the bubble clears it, and the kit's blocks and the join moved with the box.

**New props, drawn from their keys.** `src/library/worlds/actors.tsx` draws five more actors: `lid`, `arch`, `ring`, `patch` and `bead` (the last four are the pieces the gadget projects, built from the shapes `props/Pieces.tsx` already had, plus a two-by-two `PatchPiece`). A placement has no scale and no angle, so two props follow their position keys: the lid's anchor is the middle of its front edge, and the angle it is drawn open at is the one whose front edge stands at that height above the closed box (`lidAngleAtFrontY` in `props/Box.tsx`); the bubble's drawn size is a fifth of its `scale` where its centre is at the box's mouth and the whole `scale` from 87 px above. The gadget is drawn under the bubble now, so it reads as inside it.

**The props gate.** `render-props.mjs` rendered every actor on the middle frame of its beat, so a prop that comes on later in the beat (the bubble, the ring) was compared with itself and would have failed `probe-props`. It now renders such a prop on the middle of its time on stage (`<beat>--at-<actor>.png`) and writes `stills.json` with the frame of every still; `probe-props.py` refuses a with and a without still of two frames (a pair of two frames differs by a whole picture whether or not the prop is drawn: the first version of the fallback passed the planted missing still for exactly that reason).

## What the measure lines say, each against the file or the picture

`out/b12/measure.py out/animatic-06-draft-fig-seq` reads them:

| Measure line | Reading | Met |
| --- | --- | --- |
| sp-1.1 lid angle 0; emitter count 1 | lid angle 0.0 degrees on f0; one emitter in the beat | yes |
| sp-1.2 lid from 0 to open; key on the story point's frame | 0 degrees to 105 between 54 and 72; key on 60 | yes |
| sp-1.2 hands visible after, not before | both hands are drawn on f0 | no (p017) |
| sp-1.2 light area grows 4 frames or more after the lid | the glow is one constant size | no (p019) |
| sp-1.3 bubble grows over 40 frames; gadget inside | radius 19 to 93 px over 110-150; gadget on at 138 | yes |
| sp-1.3 Codex's lean precedes Clawd's by 4 | first move on 108 and 112 (keys 106 and 110) | yes |
| sp-2.1 bubble absent after the pop; one smear frame | gone on 190; no smear drawn | partly |
| sp-2.1 field hue area jumps | no change in the glow's size | no (p019) |
| sp-2.2 piece count from 0, staggered 3 or more | 0 on 229, 2 by 329, twelve frames apart | yes |
| sp-2.2 human turns 90 degrees or more | hips turn 180 degrees from 190 to 228 and 180 from 228 to 266 | yes |
| sp-2.2 eye on the trio | 0 of 100 trio frames over 3 % | yes |
| sp-2.3 shrink key on 330 | on 330 | yes |
| sp-2.3 6 arrivals or more on one frame | 3 named props on 330 (about 20 drawn pieces) | no (p018) |
| sp-2.3 Clawd moves 40 px or more | 58 px (keys 334-346) | yes |
| sp-2.3 Codex holds a prop | the ring is in his hands from 338 (contact declared on 338) | yes |
| sp-2.3 human height falls 15 % or more | 720 px on 329 and on 419; `human.small` reads -20.7 % only because beat 3's figure is 571 px on 420 | no (p020) |
| sp-2.3 eye on the human | 0 of 90 human frames over 3 % | yes |

## Gates (by hand, on these frames)

| Gate | Result |
| --- | --- |
| `probe-story.py` | six of six in beats 1 and 2 pass (above); the film `FAIL: story - 16 of 29 checks failed` |
| `probe-eyetrace.py` on 0-419 | `pass: eye-trace - the brightest region outside the fixed roles sits within 3 % of its story point's target on all 418 measured frames (2 skipped)`, with the five rows below; as the tables stand, `input error: blocking actor 'lid' has no native size in probe_common.PROP_NATIVE` |
| `probe-blocking.py` | `pass: blocking-contract - 8 beats staged: actors placed, emitter inside the frame, a card cited, identity boxes apart, props apart` with the rows; as the tables stand, `FAIL: blocking-contract - 2 of 8 checks failed: props apart, actor tables` |
| `probe-all.py --contract v3/poses v3/keys v3/charts` | `pass: probe-all --contract - 2 of 2 probe runs passed, 1 shot(s) skipped` |
| `probe-all.py` on the shot s01, with the rows | `pass: probe-all - 7 of 7 probes passed` |
| `probe-all.py` on the film | `ERROR` as the tables stand (eye trace and colour stop on `lid`); with the rows `FAIL: probe-all - 4 of 7 probes passed`, all four failures in beats 3-8 (the eye trace on frame 690 and the later beats' targets, the colour pair at 1612-1685, the loop probe on the line-phase frames from 919, which differ from animatic 05's because the beat-4 worker's swoop mesh is drawn there now) |
| `probe-props.py` | `pass: props-drawn - 16 props named by the blocking are all on their beats' frames`; its control, the ring's own still removed, reads `FAIL ... actor 'ring' is compared across two frames (everything-at-once.png is frame 300, everything-at-once--no-ring.png is frame 375)` |
| `npm run bible` | `pass: bible c26df999dc84 covers 1950 frames in 10 tracks (386 items), 20 proposal(s) sit inside their beats, 56 ruling(s) mirrored, and the page shows this bible` |

## What is open

- **The five table rows.** `probe_common.PROP_NATIVE` and `probe-blocking.PROP_EXTENT` belong to the beat-4 worker and need one row each for `lid`, `arch`, `ring`, `patch` and `bead` (`out/b12/table-rows.txt` has the text; `out/b12/with_tables.py` and `out/b12/shim/sitecustomize.py` add them in memory, which is how every "with the rows" line above was made). Until they are in, the eye trace, the colour probe and the blocking contract stop on the first of the five names.
- **p017** (finding): the hands are drawn from frame 0; nothing in the blocking or the sheets can put a sleeve over them.
- **p018** (finding): `blocking.actors` holds one actor per kind and `pieces.count` lists five, so six arrivals on one frame cannot be named.
- **p019** (finding): the animatic's light is one constant emitter per beat; the seam cannot widen after the lid and the field cannot jump at the pop. It needs a light key track.
- **p020** (finding): the shrink drawing is as tall as the joy drawings and the figure's scale cannot be keyed.
- The chart's other actors (`box.lid`, `bubble.size`, `gadget.rise`, `codex.lean`, `clawd.push`, `pieces`, `pulses`) still carry the old timing of the shot render (`ShotS01`: lid cracks at 44, pop at 180, pieces from 186); only the human's keys were retimed there, so a shot render of s01 would play the new human against the old props.
- Placement keys have no `scale`: the lid's angle and the bubble's size are read from `y`. A `scale` on `PlacementKey` (blocking.ts, the beat-4 worker's file) would let both say what they mean.
- The half-size video `out/animatic-06-draft.mp4` was not rendered (the render was stopped at 1159 of 1950 frames at load 60); frames 979-1299 of the composed sequence come from a second render because a shard of the first died on a page timeout.
