## Context
Blocking step of animatic 10. Every beat's `v3/blocking/<beat>.json` was restaged toward its story points (rows 9.5 and 9.6): beats 1 to 4 earlier, beats 5 to 8 in this slice. The staging is read by `probe-story.py`, `probe-theme.py` and the eye trace, so a staging that does not do what a story point says is refused by a probe and not by eye. Before this run the film read 3 of 29 checks failing; it now reads `pass: story - 28 of 28 story points pass` (by hand on `out/animatic-seq`, which I refreshed from `out/animatic-10-draft-seq` so the gates read this staging; the old frames are `out/animatic-seq-pre10` and the other three `-pre10` directories).

## Analysis
| Beat | Actors placed | Emitter start to end | Card | Derived from |
| --- | --- | --- | --- | --- |
| arrival | human, codex, clawd, box, bubble, gadget, lid | [900, 402] to [910, 382] | eagle-lyio3is7tokub | restaged 2026-10-19 (row 9.6, beat 1): the box, lid, bubble and gadget |
| everything-at-once | human, codex, clawd, arch, arch-2, bead, bead-2, bubble, gadget, patch, ring, ring-2, stalk | [905, 336] to [905, 336] | seuss-no-one-youer | restaged 2026-10-19 (row 9.6, beat 2): the bubble pops inside 186-229 |
| cant-build | human, codex, clawd, patch, patch-2, patch-3, stalk | [411, 638] to [411, 638] | eagle-lxu2uuohr9v2c | restaged 2026-10-19 (animatic 04, blocking step): props apart |
| the-frame | human, codex, clawd, frame, heap | [780, 390] to [800, 400] | seuss-nested-frames | restaged wide 2026-10-19 (D101, row 9.5) |
| art-world | human, codex, clawd, frame, crayon, heap, stalk, stroke-1, stroke-2, stroke-3 | [1110, 520] to [1110, 520] (the beat's `lit` actors move it: crayon, then the stalk's leaf) | seuss-cat-stairway | restaged 2026-10-20 (row 9.6, beat 5) |
| crossing | human, codex, clawd, frame, grid, heap, stalk | [800, 274] to [800, 274] (the lit stalk moves it; a lantern of radius 60) | eagle-mf83t1h77o7bm | restaged 2026-10-20 (row 9.6, beat 6) |
| programming-world | human, codex, clawd, frame, bead, grid, heap, pointer, stalk | [800, 274] to [800, 274] (the join, then the running bead, then the frame's interior from 1620) | seuss-archbishop-katz | restaged 2026-10-20 (row 9.6, beat 7) |
| home-settle | human, codex, clawd, frame, gadget, heap, patch, stalk, structure, title | [1030, 400] to [1070, 400] | seuss-green-cat-lights | restaged 2026-10-20 (row 9.6, beat 8) |

## Goals
Close the red recipes without editing a probe to pass: probe-story reads three more recipe forms the director wrote (xsheet `at` a frame, picture `from` a frame, stage `carried-by`), each with a control; probe-theme honours `except_actors` (`stroke-*`: the strokes of one drawing are one piece), with controls that refuse three strokes without it and an arch with a stalk with it. Keep the frame off the stage before sp-4.2, the gadget inside its glass, one lit join at a time, and every eye target resolvable.

## Execution
Staging changes in this slice (files under `v3/blocking` and `v3/worlds`, source under `src/`): a lantern on the carried stalk in the crossing (`effects.emitter` in the ledger, `radiance.on` in `v3/worlds/line.json`, `emitter.at` radius 60 in `crossing.json`, the line world draws `Emitter.lit`); the shaded world dims the frame's rim to a quarter until the light stands at the frame (`FRAME_DIM`); the bead's glow keys in `programming-world.json` (radius 60 while it runs between gates, 100 while it rests at the third); the crossing's `lit` offset lowered so the lantern sits inside the stalk's box.
Stills: `v3/studies/animatic-10/still-f0100.png` (home), `still-f0760.png` (home, beat 4), `still-f1100.png` (crayon), `still-f1284.png` (line, the lantern), `still-f1540.png` (shaded, the bead's run), `still-f1840.png` (home, beat 8): frames of `out/animatic-seq`, not PoseSheet or WorldSheet renders.
Deviations from the layouts: beats 1 to 4 follow the layouts of `s01` and `s02` where they exist; beats 5 to 8 have no layout sheet, so their staging derives from the story points and the world contracts (each file's `derivedFrom` says so). sp-7.4 asks three figures to cross the window's x and the blocking does not stage it (proposal p030).
Gates quoted from the engine: see the review text of this step.

## Evaluation
By hand, before this step: `probe-blocking.py v3/timeline.json v3/blocking` printed `pass: blocking-contract - 8 beats staged: actors placed, emitter inside the frame, a card cited, identity boxes apart, props apart`; `probe-story.py` `pass: story - 28 of 28 story points pass`; `probe-theme.py` `pass: theme - 4 theme invariants hold on the blocking and the story points`. The eye trace is not passing on this staging: 20 frames are over 3 % (1508-1511 and 1516-1519 where the join's glow is outranked by the kit blocks' pale edge, 1532-1537, 1540-1541 and 1552-1555 while the bead moves between gates, where the human's head highlight and a block edge outrank a 60 px glow; a wider glow lights the second gate with the first and breaks sp-7.3's order). That is named, not hidden: it is not one of this step's gates.

## Refinement
Changed: `v3/blocking/crossing.json`, `v3/blocking/programming-world.json`, `v3/beats-v2.json` (crossing effects), `v3/worlds/line.json`, `v3/screenplay.json` (sp-5.1 recipe), `src/library/worlds/line.tsx`, `shaded.tsx`, `src/library/Radiance.tsx`, `src/scenes/animaticPlan.ts`, the probes named above. Receipt: `evidence/drive-5AI5jX`, `mailbox/animatic-10/03-step.md`.
