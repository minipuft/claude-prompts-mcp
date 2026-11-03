# Beat 1 pass 11 — the human, the trio as tricolor (D38, D50, D54)

Rendered 2026-10-07: [frame 0](beat1-11-f000.png), [human 2x](beat1-11-human.png), [frame 110](beat1-11-f110.png). Rubric v1.2.

## Changed

- `tokens.ts`: `identity.humanSkin` green `#67b479` with mauve shadow `#c885c2` (D54, owner chose B with A as shadow); garment roles moved to Katz blue-violet outer, cream inner, navy trousers, gold accent, since mauve now belongs to the skin shadow.
- `cast/Human.tsx` (new): the frozen B/C selection redrawn in the contour language: large forehead, wide-set eyes, small nose, tiny full lips, swept hair, layered sleeveless outer over a pale inner shirt, roomy trousers, plain shoes; stipple form shadow on skin and outer shirt; boil variant; `lift` raises the arms.
- `scenes/Beat1Opening.tsx`: human behind the box, lifting the lid.

## Grades

- C1 HOLDS — frame 0: coral, blue, green at their identity values; the trio reads as three hues at a glance.
- C2 HOLDS — skin arrives as CSS variables from the token file; no hex in the sprite.
- C3 HOLDS, C4 HOLDS — human 2x: form shadow on the far side of the face and the outer shirt, stippled, shifting to mauve.
- C10 HOLDS as poster — mark, title, trio, box; the human behind the box is the tallest mass and the box the lowest, which is the right hierarchy for "what is about to happen".
- C11 n/a.
- C14 FAILS — frame 110: the lifted arms vanish; the rotation carries them behind the head, which is drawn after them.
- C6 FAILS (carried from 09) — the seam light still floats above the box as a ball.

## Controls

- C1 tricolor: skin-10 B against A and C.
- Human construction: v2 `hair-drape-01` (balloon top, resting palms) is the failing control; the layered shirt and compact face survive the redraw.

## Owner

1. TASTE — the hair crest reads as a single horn at this scale. Keep one crest (default: widen it into the broad uneven swept mass from the frozen sheet), or keep it as a graphic spike?

## Next

- C14: draw arms after the head, cap the lift at 75°, add one anticipation dip.
- C6: thin seam emitter at the lid line, clipped by the lid; lid gets thickness.
- Then the beat 1 moving render and the twos/ones probe.
