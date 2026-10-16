# Beat 4 glass 02 — the frame interior as a GPU pass (D45, D46)

Rendered 2026-10-07 from `src/library/glass/FrameInterior.tsx` inside `Beat4Still.tsx`; `@remotion/three` 4.0.530, three 0.186.0, fiber 9.8.1. Copied unchanged from `out/`.

- [first](beat4-glass-02-first.png) 692b787076d3a1bf… — transmission 1, roughness 0.2 at reveal, warp 0.12, dispersion 1.2.
- [f060](beat4-glass-02-f060.png) d7a817c07b1e3526… and [f090](beat4-glass-02-f090.png) 9f7c4132cc306e3b… — warp 0.45, roughness 0.08 at reveal, thickness 2.2, dispersion 2.5, smaller emitter sprite.
- Renderer: on this GPU-less WSL2 box `angle`, `swiftshader` and `angle-egl` fail to create a WebGL context; `swangle` renders at ~4.5 s per 1280x720 frame. Pinned in `remotion.config.ts`.
- Mechanism: the environment (six kit pieces as flat MeshBasic boxes with designed cast-shadow planes, one additive emitter sprite, seeded motes) sits behind a warped plane with `MeshPhysicalMaterial` transmission; roughness gives diffusion, thickness and ior give refraction, dispersion gives the chromatic edge shift. No custom shader yet.

## Review (planner, before owner)

Holds: the interior no longer reads as a flat picture; the environment is a 3D space with depth, the glass bends and softens it, dispersion fringes show at the warped edges. The whole environment, not one piece, sits behind the frame (D46). Shadows are cast shapes, not bands (D47), though diffusion hides them.

Fails: warp amplitude overshoots into a melted look at the lower left; the emitter sprite floods the interior blue so the kit reads grey-green instead of the saturated five-role look; the environment is small in the frame; outlines survive only partly. Clawd's arm and the 2D frame are unchanged placeholders.
