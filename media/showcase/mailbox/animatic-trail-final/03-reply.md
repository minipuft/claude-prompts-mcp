**Summary**: The eight `v3/blocking/<beat>.json` contracts are the ones the animatic frames in `out/animatic-seq` were drawn from, so none were rewritten for this closing drive. All eight are as the earlier runs left them and `probe-blocking.py` exits 0 on them; no defect is planted in this drive.

## Context
Beats from `v3/timeline.json` (8, byte-identical after recompile in step 1). Layouts on disk: `v3/layouts/s01-arrival-overwhelm.json` and `s02-cant-build-frame.json`. Schema and proven staging: `v3/blocking/test-scene.json`. Each blocking file cites its board card by id (`card`, `cardNote`).

## Analysis
Blocking (beat, actors placed, emitter start to end in stage px, card, derivedFrom):

| beat | actors placed | emitter | card | derivedFrom |
| --- | --- | --- | --- | --- |
| arrival | figure 0.68 at (420,40), codex, clawd, box (1010,440), bubble (1010,380) | (1000,396) to (1010,384) | eagle-lyio3is7tokub | test-scene |
| everything-at-once | figure 0.68, codex, clawd, gadget (1040,330), stalk (900,300, left) | (1010,384) to (1040,330) | seuss-no-one-youer | test-scene |
| cant-build | figure 0.58 at (452,85), codex, clawd, stalk (900,440, right) | (441.6,637.9) fixed | eagle-lxu2uuohr9v2c | s02 layout emitter.startXY |
| the-frame | figure 0.58, codex, clawd, frame (910,70) 280x230 | (1000,140) to (1060,200) | seuss-nested-frames | s02 layout emitter.endXY |
| art-world | figure 0.58, codex, clawd, test-scene props | (1000,390) to (1080,390) | seuss-cat-stairway | test-scene |
| crossing | same | (1040,390) fixed | eagle-mf83t1h77o7bm | test-scene |
| programming-world | same, gates (150,388) (235,382) (325,376) | (150,388) to (325,376) | seuss-archbishop-katz | test-scene |
| home-settle | figure 0.58, codex, clawd, gadget, structure (1040,440, x1.2) | (1000,340) to (1080,340) | seuss-green-cat-lights | test-scene |

Every file is `provisional: true`.

## Goals
Every actor the ledger names has a position, the emitter sits inside the frame, a card is cited, identity boxes stay apart. All hold.

## Execution
Stills are the animatic's own frames at mid-beat in `v3/studies/animatic-02/` (`staging-0090.png` arrival, `staging-0990.png` art-world, `staging-1230.png` crossing, `staging-1470.png` programming-world), rendered in an earlier run from these contracts; nothing was re-rendered here.
Deviations from the layouts: (1) `arrival` and `everything-at-once` derive from the test scene although an s01 layout now exists, because re-pointing the emitter would change the rendered light and invalidate the existing frames. (2) The contract lists a `box` and a `bubble` for `arrival` that the render does not draw; the probe reads the contract, not the picture. (3) The human plays one lift pose in every still, from the provisional pose chart.
Changed (files): none.

## Evaluation
Gate command `python3 scripts/animation/probe-blocking.py v3/timeline.json v3/blocking`, exit 0, fresh run:
```
control: actor with no position -> FAIL (actors positioned and scaled); emitter outside the frame -> FAIL (emitter inside the frame); missing card -> FAIL (composition card cited); overlapping identity boxes -> FAIL (identity boxes apart); beat with no file -> FAIL (one file per beat); clean fixture -> pass (0 failures)
  ok   one file per beat: 8 beats, 9 blocking files
  ok   actors positioned and scaled: every actor the ledger names is placed
  ok   emitter inside the frame: emitter start and end inside the frame on every beat
  ok   composition card cited: every beat cites a card
  ok   identity boxes apart: Codex, Clawd and the human's crop never overlap
pass: blocking-contract - 8 beats staged: actors placed, emitter inside the frame, a card cited, identity boxes apart
```

## Refinement
The engine's recorded exit is the receipt; the hand run above only repeats it.
