# Animatic scaffold 01 (2026-10-14)

The film now has a timeline in frames, tracks that code reads, and a 65 s animatic the owner can watch. Everything lives in `src/library/animation/`, a folder that is not allowed to import the cast, the worlds or the props: it takes scenes and renderers as parameters, and `src/scenes/` does the wiring. The look of every world sheet, `MeshProof` frame 36, `ModelSheetHuman`, `LayoutSheetS02` and `WorldCrossingProof` frame 60 is byte-for-byte what it was before.

## What each primitive is

| Primitive | File | What it is |
| --- | --- | --- |
| Timeline | `animation/timeline.ts`, `v3/timeline.json` | The beat ledger (`v3/beats-v2.json`, seconds) compiled to frames at 30 fps: each beat's start and end, its world, the crossing windows between beats whose worlds differ, and the state flips with the frames they hold. Beats are cumulative: lengthening one moves every later beat. A crossing window is the last third of the beat before the cut plus the first third of the beat after, each side capped at 35 frames (70 in all, the length `Crossing` already uses). |
| Track | `animation/track.ts` | A keyframed value (`frame`, `value`, optional `hold` and `ease`) and `sample(track, frame, {quantise, lerp, breakdowns})`. Without `lerp` it only holds; with `lerp` it eases; with `breakdowns` it plays pose-to-pose (hold, jump to a third, jump to two thirds, land). `poseAt` is now this function with the pose blend passed in. |
| Blocking | `animation/blocking.ts`, `v3/blocking/*.json` | Where the figure, companions, frame, blocks, join, arch, gates and floor stand, in pixels. Worlds receive one through `SceneProps.blocking` (default: `test-scene.json`, the old `STAGE` values). Between beats the placement eases on twos. |
| Camera | `animation/camera.ts` | Centre, zoom and rotation sampled on ones, applied as a CSS transform around any scene (`CameraView`). `cameraFromLayout` builds a start-to-end move from a layout contract's numeric fields, else a locked camera. |
| Keys | `animation/keys.ts`, `v3/keys/s02-cant-build-frame.json` | Named poses with frame, hold and breakdowns, validated on load; `describeFrame` says whether a frame is a key, a hold or a breakdown. |
| Light | `animation/light.ts` | The emitter colour per frame on ones: one hue per beat, eased into the next over the first half of a crossing (or 30 frames when there is none), so the colour never detours. |
| Exposure sheet | `animation/xsheet.ts`, `scripts/animation/xsheet.mjs`, `v3/xsheet.html` | One row per frame: beat, world, held drawing, what the finished pass draws (key, hold, breakdown and its favour), camera, emitter colour, crossing phase. Written from `src/scenes/animaticPlan.ts`, the module the animatic is drawn from, so the sheet cannot describe a film the animatic does not draw. |
| Boundary gate | `scripts/animation/check-boundary.mjs` | Fails, naming file and line, when anything in `src/library/animation/` imports `cast/`, `worlds/`, `props/`, `tokens`, `Radiance`, `Sprite` or `design`. Runs its own positive control first. |

## Checks

| Claim | Command | Baseline → measured |
| --- | --- | --- |
| The compiled beats sum to the 65 s ledger | `node scripts/animation/compile-timeline.mjs` | declared 1950 → 8 beats, 1950 frames, 4 crossings |
| Lengthening one beat moves every later beat | same command on a copy of the ledger with `cant-build` 7 s → 8 s | later beats shift +0 → +30 each (`the-frame` 630 → 660 … `home-settle` 1650 → 1680); total 1950 → 1980 |
| A ledger whose declared length is stale is refused | same copy, `durationInFrames` left at 1950 | exit 0 → exit 1: "the beats sum to 1980 frames, the ledger declares 1950" |
| `poseAt` over `Track` changes no joint | `poseAt(liftChart, f)` for f 0..89 with and without parents, plus an unsorted chart over f -4..99, bundled from the old tree and the new one, compared as JSON | 374 poses, byte-identical |
| `MeshProof` frame 36 unchanged | `remotion still … MeshProof --frame=36` before and after; `python3 scripts/measure-worlds.py control` | MAD 0.0000, 0 differing pixels (and the control, `WorldSheetLine` vs `MeshProof`, differs: MAD 39.41) |
| World sheets render the same through blocking | `remotion still … WorldSheet{Home,Crayon,Line,Shaded}` before and after, `cmp`; also `cmp` against `v3/studies/world-sheet-*.png` | 4 of 4 byte-identical to the pre-edit render and to the study stills |
| Other existing stills unchanged | `ModelSheetHuman`, `LayoutSheetS02`, `WorldCrossingProof --frame=60`, `cmp` | 3 of 3 byte-identical |
| Camera moves on ones, the figure's drawing steps on twos | `CameraReelHome` (30 frames, pan right 240 px and push 1.15x, figure chart that moves on every pair), consecutive PNGs compared; `poseAt` and `cameraAt` sampled | picture differs on 29 of 29 consecutive pairs; `poseAt` changes on 14 frames, all even (2, 4 … 28), 0 odd; camera changes on 29 of 29 |
| ... and the control: with the camera locked the figure alone steps on twos | same reel, `--props='{"locked":true}'`, figure crop only (x 380, w 500) | 14 pairs differ, frames 2, 4 … 28, 0 odd. (The whole locked picture still differs on 29 of 29: the radiance motes drift on ones by design, so the figure crop is the fair probe.) |
| The animatic renders in time | `npm run animatic` (`--scale=0.5 --concurrency=4`) | limit 600 s → 328 s wall; `out/animatic-01.mp4` 640x360, 1950 frames, 65.000 s, 6.3 MB (`ffprobe`) |
| The exposure sheet has a row per frame | `npm run xsheet`; rows counted in `v3/xsheet.html` independently, frames checked to be 0..1949 | 1950 rows, timeline duration 1950, sum of beat frames 1950, consecutive |
| The boundary gate sees a violation | `npm run check:animation-boundary` with a scratch `zz-scratch.ts` importing `../worlds` in `src/library/animation/`, then removed | control 8 of 8 planted imports trip; scratch file → exit 1 `src/library/animation/zz-scratch.ts:2: imports "../worlds"…`; clean tree → exit 0, 7 files |
| Types | `npx tsc --noEmit` | clean |

## What is placeholder

- **Keys.** Only `s02-cant-build-frame` has a key sheet, and it is `liftChart`'s three keys (rest, raise, settle) renamed: the PuppetProof lift, not s02's reach. Every other beat plays `liftChart` from its own first frame. The animatic holds these poses with no inbetweens, so after about frame 50 of each shot the human stands still, and at a cut inside a crossing the held pose jumps (the-frame ends on `settle`, art-world starts on `rest`).
- **Blocking.** `v3/blocking/<beat>.json` is `provisional`. Six beats are copies of the test scene. `cant-build` and `the-frame` move the join and the two blocks to the s02 layout's emitter points (0.345, 0.886) and (0.600, 0.481); the layout's figure heights are not used (63.4 % measures the human bent in the reach, and the end height is null).
- **Camera.** Only s02 has a layout, so only s02 moves: a pan right and up following half the emitter's travel (a default, `follow = 0.5`), settling back during the next crossing. Every other beat is locked. The ledger's pushes, drifts and pull-backs are not charted yet.
- **Light.** The emitter colour is the shot's `radiance` hue (D74). s02's `#17263a` is very dark, so cant-build and the-frame are nearly unlit on black. Beats the shot list does not name use the shot their ledger `effects.radiance` line names (art-world and crossing: s03, programming-world: s02, home-settle: s04). The accent shows only as a swatch in the caption strip.
- **Crossings.** Every crossing uses the line-world operator with a lead of 56 px right, whatever the move's real leading line is.
- **Worlds.** The crayon scene bakes its noise bitmaps for the first blocking it sees; a later beat with a different `figureCrop` would be rendered correctly but slower. All provisional blockings share one crop.

## Addendum — reconciled with the probes

The primitives and the probe toolkit were written apart: the probes read a staging, an exposure sheet and a light contract in a shape the primitives did not yet write. This pass makes them write it, renders the real animatic, and runs `probe-all.py` on the real frames. **2 of 7 probes pass; 5 fail, and each failure is named below as a defect of the film or a fix to the probe.**

### What now exists

| Artifact | Written by | What it carries |
| --- | --- | --- |
| `v3/blocking/<beat>.json` (8 files) | hand, provisional | the old keys unchanged, plus `actors` (box, bubble, gadget, stalk, structure, by beat), `emitter {start, end, anchor}` in stage pixels, `card` (a `board.json` id) and `cardNote` ("provisional: …") |
| `v3/xsheet.json` | `npm run xsheet` | 1950 rows `{frame, beat, world, key, hold, breakdown, camera{x,y,zoom,rot}, emitter{x,y,hex}, phase}`, from the module the Animatic draws from |
| `v3/light.json` | `npm run light` (`compile-light.mjs`) | per beat a pair, an emitter (colour, intensity, on, off, path as fractions of the frame), radiance and grain; per crossing a hue path of 5 stops on the shortest arc |
| `Animatic65` | reads `light.json` when it covers every beat and crossing | emitter position follows the blocking path, colour and intensity come from the contract, a crossing walks its path; otherwise the shot-hue derivation of before |

### Checks

| Claim | Command | Result |
| --- | --- | --- |
| Blocking carries what the probe reads | `python3 scripts/animation/probe-blocking.py v3/timeline.json v3/blocking` | exit 0, 5 of 5 checks ok. Control line trips (5 planted defects refused, clean fixture passes). Real-file control: `structure` deleted from a copy of `home-settle.json` → exit 1, "1 of 5 checks failed: actors positioned and scaled" |
| The exposure sheet has a JSON row per frame | `npm run xsheet` | `xsheet: 1950 rows (1950 <tr> in the file) for 1950 frames -> v3/xsheet.html; 1950 rows -> v3/xsheet.json` |
| The sheet and the timeline agree | `python3 scripts/animation/probe-screentime.py --timeline v3/timeline.json --xsheet v3/xsheet.json` | pass: "8 beats and 4 crossings match the timeline within 1 frame" |
| The light contract keeps the colour rules | `python3 scripts/animation/probe-colour.py --contract v3/light.json --timeline v3/timeline.json` | exit 0, 5 of 5 ok (8 pairs, 7 emitters handing off 2 frames apart, 4 crossings without a hue detour). Real-file controls: `everything-at-once` emitter pulled on at 100 → FAIL "two emitters live on frames 100..177"; first crossing path edited to pass through #10a030 → FAIL "hue detour, sample 1 (133 deg) sits 81 deg behind the start" |
| Types | `npx tsc --noEmit` | clean |
| Boundary | `npm run check:animation-boundary` | control 8 of 8, 8 files, 0 violations |
| Existing stills unchanged | `remotion still … MeshProof --frame=36` and `WorldSheet{Home,Crayon,Line,Shaded}`, `cmp` against `out/baseline/pre-*.png` | 5 of 5 byte-identical |

### The probes on the real frames

Frames: `npx remotion render src/index.ts Animatic65 out/animatic-seq --sequence --image-format=png --scale=0.5 --concurrency=4 --props='{"captions":false}'` (1950 frames, 5:32 wall) and the same with `--frames=0,10,…,1940` to `out/animatic-seq-b` (195 frames, 48 s). **Scale 0.5 (640x360), not full.** The figure crop and the loop-closure speck size scale with the frame width; the count thresholds (`--min-pixels 4`, 30 saturated pixels, 8 outside) are absolute and were set on 320x180 fixtures, so they are stricter in area at 0.5 than the fixtures were and were not re-derived for full scale. Determinism hashes bytes and does not depend on scale.

Command: `python3 scripts/animation/probe-all.py out/animatic-seq --timeline v3/timeline.json --xsheet v3/xsheet.json --second-frames out/animatic-seq-b --subset --json out/probe-all.json` (verbatim output: `out/probe-all.txt`; exit 1).

| Probe (rubric) | Result | Control line (verbatim) |
| --- | --- | --- |
| twos-ones (C27) | pass: 72 even-frame changes, 0 odd | change on frame 7 -> FAIL (odd-frame figure changes at [7]); changes on even frames only with the camera moving every frame -> pass (0 odd-frame changes, 7 even-frame changes, camera moved on 24 odd frames) |
| hold-band (C28) | FAIL: hold of 36 frames at 0-35, 180-215 and 420-455 | 40-frame hold -> FAIL (hold of 40 frames at 0-39 is over 27 and no key declares it); 16-frame hold, 4-drawing move -> pass (2 holds, move of 4); 40-frame hold declared by key 'K1' -> pass and listed; 1-drawing move -> FAIL |
| screen-time (C26) | pass | beat 'b' shifted 3 frames against the same xsheet -> FAIL (beat 'a' ends at frame 30 in the xsheet, 33 in the timeline); unshifted -> pass (0 problems) |
| eye-trace (C29) | FAIL: 1820 of 1820 measured frames over 3 % (130 skipped, no emitter) | bright blob 10 % of the width off the emitter -> FAIL (offset 10.0 % > 3 %); blob on the emitter -> pass (0.0 %); identity patch brighter than the blob is ignored (read as bright it would put the offset at 54 %) |
| loop-closure | FAIL: closed on 13 of 142 line-phase frames | synthetic closed outline closed=True (height 1.000, share 1.000); 4 px band erased across the shins (row 127) closed=False (height 0.744, share 0.588) flips |
| colour-continuity (C30, C24) | FAIL: 1620 frames outside the pair; 4 of 4 crossings flagged | magenta patch off both pairs -> FAIL (frame 5: 576 of 15376 saturated pixels outside); hue detour through green across a crossing -> FAIL (crossing 14-34 detours: sample 1 (205 deg) sits 16 deg behind the start); clean sequence with an identity-pigment patch -> pass |
| determinism (C12) | FAIL: 178 of 195 frames identical | one altered pixel -> FAIL (frame [0] differs); two writes of the same frame -> pass (1 frame, 0 differ) |

Real-frame controls, because a synthetic control proves the probe fires, not that it fires on these pictures: `probe-loop.py` repeats its control on the first real line-phase frame (799: intact closed=True, band erased closed=False, flips). For twos, frame 533 (a moving-camera frame) replaced by frame 460 in a 7-frame copy → FAIL "1 odd frame(s) where the figure changed: [533]"; the unplanted copy of 530..536 → pass.

### What failed for real (left failing)

| Probe | Defect in the film | Evidence |
| --- | --- | --- |
| hold-band | The placeholder `rest` key declares a 24-frame hold, but a holds-only animatic keeps the pose until the next key: 36 frames, over the 11-27 band, in `arrival`, `everything-at-once` and the first beat of s02. | frames 0-35, 180-215, 420-455; the xsheet row says `hold: 24` |
| (none catches it) | The held-pose jump at the cut: `the-frame` ends on `settle` (arms raised) and `art-world` starts on `rest` (arms open) inside the 775-845 crossing, so the twos and hold probes exempt it. | `out/animatic-seq/element-0805.png` against `element-0811.png`. A gap in the toolkit, not a failure of it |
| eye-trace | The brightest non-identity pixels are the human's cream garment, never the emitter: the centroid sits inside the figure crop (x 380-880) on 365 of 366 sampled frames (every 5th). The Turrell blue emitter (#0a51fb, luminance 78 of 255) and the steel one (#17263a, 36) cannot outshine it. | worst offset 59.2 % at frame 1149 |
| eye-trace | The light cannot be drawn where two beats put it. `JoinGlow` clips the glow to a 200x160 rectangle around `blocking.join` (`worlds/parts.tsx`); the frame interior (`the-frame`) and the gates (`programming-world`) lie outside it. Frame 700: the frame interior is black. | `out/animatic-seq/element-0700.png` |
| loop-closure | The figure is clipped by the frame: on 142 of 142 line-phase frames ink touches the crop's bottom edge (boots and floor lines), and on 93 of 142 the top edge (raised hands). The probe was proven on `WorldCrossingMeasure`'s 1160-tall canvas. | measured on `out/animatic-seq` |
| colour-continuity | The palette does not follow the beat's pair: saturated pixels outside the pair ±15° are 23-74 % of each frame, and still 16-100 % with the figure and companions masked (frame 60 of each beat). The kit blocks, the amber frame and the human's garment keep fixed colours; only the emitter follows the pair. | beat frames sampled: arrival 30 %, everything-at-once 26 %, cant-build 92 %, the-frame 100 %, art-world 41 %, programming-world 16 %, home-settle 30 % |
| determinism | The renderer is not byte-identical. Against the full sequence the subset render differs on crayon frames 850 and 860 by 44 709 and 45 407 pixels (max 90 and 92 summed levels): state carried between frames in one tab (a lone render of 850 equals the subset, not the sequence). Two renders of the same 195 frames differ on 4 (1250, 1290, 1640, 1650), at `--concurrency=4` and at 1 (1270, 1280, 1290, 1650): 3-1400 pixels, up to 163 summed levels, in the line and shaded crossings. | `out/animatic-seq-b2`; `/tmp/c1a` and `/tmp/c1b` were scratch |

### What was a shape fix (probe or data), with before and after

| Where | Before | After | Why |
| --- | --- | --- | --- |
| `probe_common.change_series` (twos, holds) | exact compare at a summed-RGB threshold of 24: **175 odd frames** flagged in the two moving-camera beats, 2500-8000 changed pixels per frame | where the camera moved between the two frames, both crops go through a 5x5 box blur (10 stage px, scaled) and count above 96; static frames unchanged. **0 odd frames**; the planted odd change on a moving frame still trips; real key changes stay at 6600-20500 px | sub-pixel camera moves resample every 1 px ink edge |
| `probe_common.world_crop` | rows the camera view does not reach were edge copies and counted: 9 odd frames at 499-637 | `valid` mask, eroded by the blur kernel, excludes them: 0 | the crop's bottom rows lie off-screen when the camera pans up |
| `probe-holds.py` | every pixel change was a drawing: in the first real run 20 hold failures and 11 one-drawing moves, nearly all in the crayon world (changes of ~22 000 pixels every 6-10 frames) | with key or breakdown rows in the xsheet, a change with none within 1 frame is boil and does not end a hold (155 counted); without key rows, as before. 3 failures left, the real ones above | the board allows boil inside a hold, and boil changes as many pixels as a small pose change, so pixels alone cannot tell them apart. Cost: an unmarked pose change reads as boil; the twos probe and the xsheet are the check on that |
| `fixtures/make.py` holds fixtures | no key rows | a key row at every change frame, so the controls keep their meaning under the rule above | |
| `probe-eyetrace.py` | `--emitter-space screen` default: the xsheet's stage-pixel emitter read as frame coordinates | `world` default: projected through the row's camera. No change to the verdict here (still 1820 of 1820) | the xsheet contract says stage pixels, and the camera moves in s02 |
| `Animatic` | caption strip always on | `captions` prop (default true); probe renders pass `--props='{"captions":false}'`. The loop probe went from 12 to 13 of 142 closed: the caption was not the cause | the strip is review chrome over the picture |

Not changed: the colour, loop and determinism probes, and every threshold not named above (hue tolerance 15°, 3 % eye trace, band 11-27, 95 % loop share).

### Decisions this pass made that the owner may reverse

- **The emitter now follows the blocking path in the render.** Before, the Animatic drew it at the eased `join`. After, an emitter starts at its beat's start, goes off 2 frames before the next emitter's beat (C18), and the crossing beat has none (intensity 0, null in the xsheet). `arrival` runs at intensity 0.5 ("tiny"), every other at 0.9. The picture in `out/animatic-01.mp4` therefore changed and the file was re-rendered.
- **`programming-world` emitter colour is the shaded world's own cyan (#56b0d4), not the s02 radiance (#17263a).** The ledger says "s02 accent as the world's hue"; the world's radiance colour sits within 15° of the accent's hue, so it stands in.
- **Blocking placeholders** (`actors`, `emitter`, `card`) are provisional and unreviewed. Cards: arrival `eagle-lyio3is7tokub`, everything-at-once `seuss-no-one-youer`, cant-build `eagle-lxu2uuohr9v2c`, the-frame `seuss-nested-frames`, art-world `seuss-cat-stairway`, crossing `eagle-mf83t1h77o7bm`, programming-world `seuss-archbishop-katz`, home-settle `seuss-green-cat-lights`. The `the-frame` emitter is in the frame interior as asked, while the file's `join` is still the layout's (768, 346), outside the frame at (910, 70).
- `Animatic` imports `v3/light.json` statically, so "when present" is "when it covers every beat and crossing"; a missing file is a build error, an empty or stale one falls back.
