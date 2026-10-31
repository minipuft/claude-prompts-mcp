# Beat 4 seuss 07 — first receipt graded against rubric v1

Rendered 2026-10-07. [full](beat4-seuss-07-f090.png) d422cc6d3b4f45b5…, [frame 3x](beat4-seuss-07-frame.png), [gadget 3x](beat4-seuss-07-gadget.png). Graded against [rubric v1](../rubric.md).

## Changed

- `glass/FrameInterior.tsx`: towers forward and larger at the sides, ground stipple denser and coarser, light string higher and in front.
- `props/Gadget.tsx`: flared funnel with a highlight stroke; form shadow clipped to the body path.
- `props/Frame.tsx`: redrawn in the Seuss contour language, uneven bars, pale contour, corner overshoots, gold from the gadget roles.

## Grades

- C1 HOLDS — full still, Clawd coral and Codex absent — unchanged across passes 03–07.
- C2 HOLDS — token resample in 06 touched `tokens.ts` only; asset files unchanged.
- C3 HOLDS — gadget 3x: form shadow follows the lobes, cast shadow a splatter shape under the legs.
- C4 HOLDS — gadget 3x: two-scale stipple, hue shifts to violet at the base.
- C5 HOLDS — full still: black field, three subjects, nothing else drawn.
- C6 FAILS — full still: no emitter reads at all; the light string and motes are not visible through the glass. Suspect additive sprites are lost in the transmission pass.
- C7 HOLDS as still, UNPROVEN as motion — frame 3x: tunnel depth, warp, diffusion, edge shift all present; awaiting the moving render.
- C8 HOLDS — frame 3x: receding turned rings, blue silhouettes with cream contour, stalks with leaves; beaded light absent (see C6).
- C9 HOLDS — frame 3x: contours survive the grain.
- C10 HOLDS — full still: the interior is the subject; towers now flank rather than block; gadget and Clawd support.
- C11 HOLDS — gadget 3x: stacked lobes, dial, porthole, horn, antenna leaf; familiar parts, impossible whole. Funnel now reads as a horn rather than an arm.
- C12 HOLDS — frame 60 rendered twice as stills: sha256 c6e754172eb2… both.
- C13 HOLDS for stipple, UNPROVEN for glass — [consecutive 59/60/61](beat4-seuss-07-consecutive.png): the dots do not move; measured change >8 levels: Clawd 0.14–0.16 % of pixels (the arm), interior 0.56–0.79 % (slow turn), empty field 0.0 %. Glass motion needs an owner viewing of [the clip](beat4-seuss-07.mp4) (4 s, 120 frames, 1280x720, 613 kB).
- C14 UNPROVEN — no acting in this composition yet.

## Findings

- Palette travel dips to grey: at [frame 60](beat4-seuss-07-f060.png) the gadget's leaf is grey because `lerpPalette` interpolates in RGB between a warm and a cool accent. This is the hue-detour CloudySky's contracts name. Rubric v1.1 adds C15; fix is perceptual (OKLCH) interpolation in `tokens.ts`.
- Render cost re-measured: 120 frames in ~70 s on `swangle` with concurrency 2, so the 4.5 s per still was bundling overhead. A 40 s film is ~12 min here, not 90.

## Controls

- C10 flipped FAILS → HOLDS against beat4-seuss-05 (towers blocking the tunnel).
- C11 flipped FAILS → HOLDS against beat4-seuss-06 (funnel as stub arm, shadow overshoot).
- C3/C4 for the frame prop: beat4-seuss-06 (plain bars).

## Owner

1. TASTE — the frame's gold bars sit visually closer to the gadget than to Clawd. Keep the frame in gadget gold (default), or give it the human's mauve so the tool reads as the companion's rather than the machine's?
2. TASTE — the ground inside is a flat navy mass with faint stipple. Keep it quiet (default), or let a second stripe band like the Seuss stairway run across it?

## Next

- C6: move the light string and motes out of the transmission path (render them on a layer in front of the glass, or as flat Silhouette dots), and make the emitter rim visible behind the rings.
- C12/C13: hash two frames of the moving render; inspect frames 30/60/90 consecutively for shimmer.
