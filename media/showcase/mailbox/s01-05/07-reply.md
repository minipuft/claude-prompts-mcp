**Summary**: Shot s01-arrival-overwhelm rendered on the pinned `swangle` renderer: 420-frame png sequence, `out/s01-05.mp4`, a figure-only sequence, the exposure sheet and joints dump regenerated, and the three-probe gate `probe-all.py --shots v3/poses --frames-root out --joints-root out` passes 3 of 3 (exit 0). Frames 0 and 154 rendered twice are identical. The figure-only sequence is byte-identical to run 4's (420 of 420 frames).

Frames Rendered (path · sha256 prefix): full sequence `out/s01-05-seq/element-NNN.png` (420); mp4 `out/s01-05.mp4` 5a3aedb21ed80c1d (420 frames, 3.4 MB); figure-only `out/s01-arrival-overwhelm-figure-seq/` (420); strip `out/s01-05-strip.png` (frames 0, 42, 66, 104, 154, 180, 190, 210, 228, 272, 330, 419); key stills of the figure-only pass tiled `out/s01-05-key-stills.png`. Frame hashes: f0 b59133fc1e12733e, f42 1f03689a4064ec48, f66 395460bbe4ff87cd, f104 10659b54162bf511, f154 451bd3aa6453b818, f190 e7f6ca01abe311a7, f228 7150e5e54eb7f9a2, f272 94175731fe30886f, f330 5412275c028c1451, f419 3912d4fba97e790d.

Probes:
- Determinism (C12): frame 0 twice b59133fc1e12733e, b59133fc1e12733e; frame 154 twice 451bd3aa6453b818, 451bd3aa6453b818; both equal the sequence's own frames 0 and 154 (still against sequence, the pairing that failed in run 1).
- Twos and ones (C27): `probe-twos`: the drawing changed on 106 even frames and 0 odd frames, tolerance 0; the control (a change on frame 7) refused. On the figure-only pass 129 even frames changed and 30 odd frames changed, all 30 inside the camera widen (frames 150-210), none outside (`out/s01-05-measure.json`).
- Hold band (C28): 8 holds in band or declared, 7 moves of 3-6 drawings, 0 pops, one declared long hold (shrink, 148 frames).
- Inbetweens (C23, C32, C33; `out/s01-05-inbetweens.txt`): `s01-arrival-overwhelm · pass · 7 moves, 54 items measured, 0 failed`; arcs 21 items ok, spacing 7, overlap 11, moving holds 8, pixel ease 7; controls tripped (a zigzag with the same off-chord distance refused, a linear lerp refused).
- Gate lines (`out/s01-05-probe-all-shots.txt`): `twos-ones pass`, `hold-band pass`, `inbetweens pass`, `pass: probe-all --shots - 3 of 3 probe runs passed, 0 shot(s) skipped`.
- Model-sheet overlay (C20): from the keys table, 8.00 heads and limb scales 1.00 on every key, worst deviation 0.0 percent; plate against film MAD 7.3 to 9.6 (bar 10).
- Light lag (C18): pop at 180; pop ring and flood blue first respond on 178, lamp core on 182 (`lightLag`, `out/s01-05-measure.json`).
- Identity samples (C1): pixels within 6 RGB of each pigment on frames 0 / 120 / 200 / 300 / 419: Codex blue 1556 / 1564 / 657 / 248 / 160; Clawd coral 4318 / 4364 / 981 / 1193 / 335; human skin 162 / 123 / 0 / 20 / 13.
- Identity pass (D70): face crop heights 32 px (frame 0), 41 px (104), 18 px (419), `out/s01-05-identity-pass.png`.
- C25: lamp centroid on frame 300 at (696.5, 223.5) against the layout's (697.6, 223.9), 0.09 percent of width; zoom end 0.6, figure-height ratio of the layout 0.4251. On frame 0 the brightest-pixel centroid is 29 percent of width from the seam (the poster's white box top, not the emitter); the exposure sheet's emitter is 2.07 percent off.
- Colour pair, identity-complete (C24): 20 sampled frames of 70 exceed 2 percent off-pair saturated pixels, worst frame 30 at 19.7 percent (known mask gap, run 1 gap 19; not a gate).

Receipt Skeleton Path: `out/s01-05-probes.json`. Renderer Used: remotion on `swangle`, `ShotS01` and `ShotS01Figure`.

Concerns: the full render shows the human's face only in the first 150 frames; from frame 190 the figure is 20 to 29 percent of frame height under the flood. Frames 0 and 154 are the only still-against-sequence pairs compared. The drive's key-step gate `animation-key-fit` was not visible in the mailbox for the delegated step (see study gaps).
