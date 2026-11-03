**Summary**: No frame was re-rendered; this reply reuses the existing frames and artifacts. The frames and mp4s are from the earlier run of the same contracts (`v3/timeline.json`, `v3/xsheet.json`, `v3/light.json`, `v3/blocking/*.json`, byte-identical after the recompiles in steps 1 and 3), and whether two sessions render the same frames is still open (plan row 4.1: the earlier run measured 1948 of 1950 frames within tolerance between two full renders). `probe-all.py`, this step's only gate, was run fresh against those frames and passes 7 of 7.

## Context
Renderer `media/showcase`, episode `v3`. Artifacts reused as they are: `out/animatic-seq` (1950 frames), `out/animatic-seq-b` (195), `out/animatic-fig-seq` (1950), `out/animatic-figline-seq` (142), `out/animatic-01.mp4` and `out/animatic-01b.mp4`, strip `out/animatic-02-contact.png`; copies in `v3/studies/animatic-02/`.

## Analysis
Watched: I did not view the mp4 in motion or the strip in this drive; what the viewer sees per beat is the existing study `v3/studies/animatic-02.md` (written from 24 viewed frames in the earlier run).
Probes, fresh run, exit 0, 129 s wall:

| claim | command | control | measured |
| --- | --- | --- | --- |
| drawing on twos, camera on ones | `probe-all.py` row `twos-ones` | frame 7 change refused | pass |
| holds inside the 11-27 band | row `hold-band` | 40-frame hold refused | pass |
| beat lengths match the xsheet | row `screen-time` | 3-frame shift refused | pass |
| the eye lands on the emitter | row `eye-trace` | blob 10 % off refused | pass |
| outlines close | row `loop-closure` | 4 px band across the shins refused | pass |
| one pair per beat, no hue detour | row `colour-continuity` | magenta patch and green detour refused | pass |
| second render matches within tolerance | row `determinism` | 60 pixels 40 levels off refused | pass |

## Goals
Run the gate's seven probes fresh on the existing frames, quote every line, and say what is reused.

## Execution
The seven lines and the summary of `python3 scripts/animation/probe-all.py out/animatic-seq --timeline v3/timeline.json --xsheet v3/xsheet.json --second-frames out/animatic-seq-b --subset --figure-frames out/animatic-fig-seq --figure-line-frames out/animatic-figline-seq` (exit 0), verbatim:
```
twos-ones · pass · control: change on frame 7 -> FAIL (odd-frame figure changes at [7]); changes on even frames only with the camera moving every frame -> pass (0 odd-frame changes, 7 even-frame changes, camera moved on 24 odd frames); a figure change on frame 27 inside a crossing window 20-35 -> FAIL on the figure layer (odd-frame changes at [27]), exempt (pass) on full frames
hold-band · pass · control: 40-frame hold -> FAIL (hold of 40 frames at 0-39 is over 27 and no key declares it); 16-frame hold, 4-drawing move -> pass (2 holds, move of 4); 40-frame hold declared by key 'K1' -> pass and listed; 1-drawing move -> FAIL; a pose change on frame 28 inside a crossing window with no key row -> FAIL on the figure layer (stray change at [28]), exempt on full frames; the same change with a key row -> pass
screen-time · pass · control: beat 'b' shifted 3 frames against the same xsheet -> FAIL (beat 'a' ends at frame 30 in the xsheet, 33 in the timeline); unshifted -> pass (0 problems)
eye-trace · pass · control: bright blob 10 % of the width off the emitter -> FAIL (offset 10.0 % > 3 %); blob on the emitter -> pass (0.0 %); identity, garment and kit-contour patches brighter than the blob are ignored (read unmasked they would put the offset at 46 %); the same blob against an emitter projected through a camera that moved 140 stage px -> FAIL (10.9 %), so the camera is read; 120 lone white specks, brighter than the blob and a share of the 0.5 % ranked, are not a region: offset 2.2 % blurred, 8.7 % unblurred
loop-closure · pass · control: synthetic closed outline closed=True (height 1.000, share 1.000); 4 px band erased across the shins (row 127) closed=False (height 0.744, share 0.588) flips
colour-continuity · pass · control: magenta patch off both pairs -> FAIL (frame 5: 576 of 15376 saturated pixels outside); hue detour through green across a crossing -> FAIL (crossing 14-34 detours: sample 1 (205 deg) sits 16 deg behind the start); clean sequence with identity, garment and kit-accent patches (all saturated, all off the pair) -> pass; a pale blue glow on the emitter reads 221 deg -> inside the blue pair, the same glow in pale green reads 144 deg -> off it, a frame with no glow reads nothing
determinism · pass · control: two writes of the same frame -> pass; 1 pixel 1 level off (rasteriser noise) -> pass; 40 pixels 1 level off (noise) -> pass; 60 pixels 40 levels off -> FAIL (60 beyond 2 levels, allowance 5); every pixel 3 levels off -> FAIL (57600 beyond 2 levels); 1 pixel 40 levels off -> tolerated (inside the allowance of 5)
pass: probe-all - 7 of 7 probes passed
```

## Evaluation
Provisional parts of this film, as listed in the study: keys (one pose chart for every beat), blocking (eight provisional files), `box` and `bubble` of the arrival beat not drawn, one crossing operator for all four crossings. Nothing here proves a determinism claim across sessions.
Owner questions, each with a default: (1) Every crossing is the same line-world drawing; keep it or draw each with its own move's leading line? Default: keep until the pose pass fills the beats. (2) The crossing beat is 4 s with four ledger actions and 6 frames to spare; lengthen to 5 s (later beats +30 frames) or keep? Default: keep, decide after watching `animatic-02.mp4`.

## Refinement
Changed: `v3/studies/animatic-02.md` gets a dated `## Closing drive` section after the drive (the per-step gate table and the receipt directory); no other file. The engine's own shell verification is the receipt once the review renders.
