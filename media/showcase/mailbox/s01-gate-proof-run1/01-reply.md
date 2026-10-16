**Summary**: Gate-proof drive of s01-arrival-overwhelm. The layout contract `v3/layouts/s01-arrival-overwhelm.json` is unchanged (last written 2026-10-15 11:40, before run 5); no sheet was regenerated and nothing was generated.

## Context
Read `v3/layouts/s01-arrival-overwhelm.json`, `v3/timeline.json`, `v3/blocking/arrival.json`, `v3/blocking/everything-at-once.json`, `assets/human/model.json`. `probe-timeline.py v3/timeline.json` passes (8 beats, 1950 frames).

## Analysis
- **Camera**: start locked medium-wide, end the full field at zoom 0.6 over frames 150-210; move: widen; led by the bubble and then the first stalk's curl.
- **Emitter**: box lid seam to the gadget's dial.
- **Figure Heights**: as in the contract (panel 1, panel 2, 8.0 heads); unchanged.
- **Hue**: D74 pair radiance #0a51fb, accent #fad204.
- **Cards Used**: unchanged from the contract.
- **Sheet Path**: `assets/layouts/s01-layout-02.png`, sha256 66445f7f..., identical to the copy in `public/assets/layouts/` (checked).
- **layout.json Path**: `v3/layouts/s01-arrival-overwhelm.json` (provisional: true).
- **Generation Receipt**: `evidence/s01/imagegen-layout-s01-02.json` (nothing generated this step).
- **Rejected Generations**: `out/s01-layout-01.png` (run 1).

## Goals
Keep the contract so the later steps run against it.

## Execution
No edits.

## Evaluation
Done: timeline probe exit 0; sheet hashes match. Concerns: panel 2 of the sheet still draws the older framing and the contract's camera pose supersedes it.
