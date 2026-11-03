**Summary**: Run 2 keeps the run 1 cinematography sheet and its contract (`v3/layouts/s01-arrival-overwhelm.json`); no sheet was regenerated, because the checks found no defect in it. One change: the widen now ends at zoom 0.6 (owner default recorded in the plan), not 0.425.

- **Camera**: start locked medium-wide (640, 360, x1); end the full field at (604, 103, x0.6) over frames 150-210 on ones; move: widen (pull back and up, no cut); led by the bubble swelling out of the box (f150-180), then the first stalk's curl (f180-210). Was (604, -144, x0.425); y 103 keeps the trio's feet at 688 of 720 px as the old pose did. The chart note, `v3/shots.json` camera string and `scripts/s01_chart.py` note follow.
- **Emitter**: start the box's lid seam (0.52, 0.777); end the gadget's dial, now (0.545, 0.311) of the frame (was (0.532, 0.512) at zoom 0.425; recomputed from the dial at stage (699, -124) through the new camera).
- **Figure Heights**: panel 1 78.1 % (face-derived, over-reads, see `figure.note`), panel 2 33.2 % (sheet, 0.425 framing); heads 8.0. The render stands the human at 350 px (48.6 %) at rest and 210 px (29.2 %) at the new end zoom.
- **Hue**: D74 pair radiance #0a51fb, accent #fad204 (unchanged).
- **Cards Used**: eagle-lyio3is7tokub, eagle-mf83t1h77o7bm, eagle-m92nkizilu1cb, eagle-mram46lymigko (unchanged).
- **Sheet Path**: `assets/layouts/s01-layout-02.png` (sha256 66445f7f...f19f; copy in `public/assets/layouts/` identical). Panel 2 still draws the 0.425 framing; the numbers in `cameraPose` supersede it (stated in `cameraPose.note`).
- **layout.json Path**: `v3/layouts/s01-arrival-overwhelm.json` (provisional: true). Still: `out/s01-layout-02-run2-still.png` (`LayoutSheetS01`).
- **Generation Receipt**: `evidence/s01/imagegen-layout-s01-02.json` (run 1; nothing generated in run 2).
- **Rejected Generations**: `out/s01-layout-01.png` (run 1: human at about 95 % of panel 1 against 50 % asked).
- **Concerns**: the sheet's panel 2 and the contract disagree about the end framing until the sheet is redrawn; the render and C25 read the contract. The exposure sheet (`out/s01-xsheet.json`) must be regenerated (`node scripts/s01-xsheet.mjs`) before the probes run.
