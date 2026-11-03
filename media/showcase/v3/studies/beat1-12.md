# Beat 1 pass 12 — lid lift in motion

Rendered 2026-10-07: [frame 0](beat1-12-f000.png), [frame 110](beat1-12-f110.png), [clip](beat1-12.mp4) 4 s, [lift strip 76–96](beat1-12-lift-strip.png).

## Changed
- `cast/Human.tsx`: arms drawn last, lift capped at 75°, hair widened into the swept mass.
- `props/Box.tsx`: lid thickness (near edge and side).
- `scenes/Beat1Opening.tsx`: seam emitter at the lid line, masked to the opening.

## Grades
- C16 HOLDS — human region per-frame change 75–82: 18.1, 2.4, 0.4, 5.6, 0.7, 9.8, 0.02, 11.3 %: drawn on twos. From 83 the seam light under the figure moves on ones and the region mixes, as designed.
- C18 HOLDS for lag (light rises from frame 83, drawn from 75), FAILS for shape — the mask is a hard rectangle; the leak reads as a lit box, which is a toggle in space the way pass 08's was in time.
- C14 FAILS — frame 110: the arms rotate inward and cross the chest; the lift must carry the hands outward and up to the lid.
- C1, C5, C10 HOLDS as in pass 11.

## Next
- Feathered mask in `Radiance` (gradient alpha, never a clip rectangle).
- Arm rotation sign flipped so the hands go out and up; one anticipation dip.
