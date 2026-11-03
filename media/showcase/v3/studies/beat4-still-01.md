# Beat 4 still 01 — first rendered proof of the v4 medium

Rendered 2026-10-06 from `src/scenes/Beat4Still.tsx` (composition `Beat4`, 1280x720, 30 fps) with `npx remotion still`; copied unchanged from `out/`.

- [f000](beat4-still-01-f000.png) sha256 d9d7e5ebfc720d61… — Overwhelm state, radiance unmasked.
- [f090](beat4-still-01-f090.png) sha256 18f3a69253bd8986… — Scaffold state, radiance masked to the frame interior, depth rings on.
- Determinism probe: frame 90 rendered twice, byte-identical (fe4f3a57…). Typecheck clean.
- Library files: `src/library/tokens.ts` (five roles, three states, per-role lerp, identity pigments outside the Palette), `Radiance.tsx` (seeded additive canvas, hue bands, depth rings, mask), `Sprite.tsx`, `cast/Clawd.tsx`, `props/Frame.tsx`, `kit/Table.tsx`.

## Review (planner, before owner)

Holds: identity pigments fixed across both states once the radiance moved under the flat assets (the first render had it on top and washed Clawd to pink; rejected, not kept). Black negative-space field reads. Frame interior at f090 reads as a lit space behind the frame, the right direction for D42.

Fails or unproven: the Overwhelm gradient is clean concentric bands, poster-like, not the board's grainy iridescent fill; it needs two-scale noise modulation and, for the gadget, radiance clipped inside a flat silhouette. Depth rings are too regular. Table is a placeholder drawing. Clawd's arm is crude. No motion reviewed yet. Token values are first samples, not approved.
