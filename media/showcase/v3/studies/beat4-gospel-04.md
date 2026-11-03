# Beat 4 gospel 04 — Midnight Gospel properties applied (D48)

Rendered 2026-10-07 after the owner supplied three stills (`references/midnight-gospel-*.jpg`, roles in `style-references.json`). [full](beat4-gospel-04-f090.png) 39ab3e886f632d61…, [Clawd 3x](beat4-gospel-04-f090-clawd.png), [frame 3x](beat4-gospel-04-f090-frame.png), copied unchanged from `out/`.

Changes: `Dither.tsx` now stipples at two scales (fine speckle + coarse splatter) and leaves color to the shape's own gradient, so shadows shift hue toward a cool violet at contact; Clawd's side shadow and arm corrected. `FrameInterior.tsx` gained a grained multi-hue field plane with splatter dots behind the environment, a film-grain plane over the glass, the emitter moved directly behind the pieces, and the warp pulled to a third.

Holds: the interior now has the references' grained gradient field and splatter; Clawd's form shadow grades by coarse stipple with a hue shift, and the cast shadow is a splatter shape; identity pigment unchanged; the glass no longer melts the forms.

Fails: film grain is uniform and too strong, so the whole interior reads sandpapered and the kit loses its outlines and depth; the kit pieces carry no stipple shadows yet, so they read flat against a textured field; the emitter rim is invisible under the grain; Clawd's arm is still a stub.
