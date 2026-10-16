**Summary**: Graded only what I viewed in this re-drive: the twelve-frame strip `out/animatic-02-contact.png` (sha256 01298a29d8d6, one frame per beat plus each crossing's middle). The probe-decided criteria cite the probe lines of step 4 and are not re-graded; criteria that need motion or the 60-frame determinism sample stay UNPROVEN here. No file under `v3/` changed in this step.

## Inspected Evidence
Viewed: the strip above (frames 90, 300, 525, 720, 810, 990, 1170, 1230, 1290, 1470, 1650, 1800), still tier only. Not viewed in this run: `out/animatic-01.mp4` in motion, the 3x crops, consecutive frames. Cited, not re-graded: `probe-all.py` seven lines of step 4 (exit 0, engine run 119919 ms and 169655 ms) and `v3/studies/animatic-02.md` for the marks from the earlier 24-frame viewing. Motion contract: no recorded Motion Contract step exists in this chain, so the handoff is flagged as missing and no motion criterion is graded.

## Grades
| criterion | mark | evidence |
| --- | --- | --- |
| C26 to C30 (twos, hold band, screen time, eye trace, colour continuity) | HOLDS | decided by the probe lines of step 4, not graded here |
| C6 one emitter per shot | HOLDS | strip: one glow in each of the seven shaded or crayon-less home and shaded frames (90, 300, 525, 720, 1470, 1800) and none in the line-world frames, as light.json says |
| C10 composition hierarchy | FAILS | frame 90 (arrival) shows a frame, a two-block join and the glow but no box or bubble, and the human stands full height with raised arms exactly as in frames 300, 525 and 1800, so the eye has the same target in four different beats |
| C8 Seuss architecture | FAILS | no towers, stalks or structure in frames 90, 300, 525, 720, 1800 |
| C13 crossings read as drawn | UNPROVEN | stills show all four crossings (810, 1170, 1230, 1290, 1650) as the same line-world drawing; whether the move reads needs consecutive frames |
| C14 acting reads without text | UNPROVEN | one pose in every beat on the strip; acting needs motion tier |
| C12 determinism, C15 palette travel, C25 layout match | not touched | earlier-run marks stand (FAILS in `animatic-02.md`); nothing viewed here changes them |

## Controls
The C10 and C8 FAILS beat the earlier study's frames: the same missing box, flood and structure are visible in this strip, so the mark does not depend on the earlier viewing. C6 HOLDS beats a frame with two glows, which no frame on this strip has.

## Owner
1. Every crossing is the same line-world drawing; keep it or draw each with its own move's leading line? Default: keep until the pose pass fills the beats.
2. The crossing beat is 4 s with six frames to spare; lengthen to 5 s or keep? Default: keep, decide after watching the mp4.

## Next
C10, C8: draw the box, bubble, stalks, gadget and structure the blocking already places (one render row). C12 and the manifest gate: `out/s01-arrival-overwhelm` is stale (render-manifest exit 1) and belongs to the live s01 render, so its owner re-renders it before this chain can pass its second gate.

## Rubric Evolution
None proposed. Standing TASTE marks: unchanged.

## Concerns
(1) The animatic step's second gate failed twice on a cache outside this task and the chain reached its retry limit; the drive continued only because I sent `gate_action: "skip"`, which the receipts record. (2) Nothing was watched in motion.
