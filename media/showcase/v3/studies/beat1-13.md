# Pass 13 — feathered light, lifted arms

Rendered 2026-10-07: [beat 1 frame 110](beat1-13-f110.png), [beats 4–5 frame 40](beats45-13-f040.png).

## Changed
- `library/Radiance.tsx`: the mask is a feathered elliptical alpha (destination-in gradient), never a clip rectangle; this also fixes pass 08's hard mask inside beats 4–5.
- `cast/Human.tsx`: lift rotates the arms outward and up (110°).

## Grades
- C18 HOLDS in space — frame 110: the leak fades over ~70 px; no edge. Beats 4–5 frame 40: the narrowing light has a soft boundary mid-raise.
- C14 HOLDS — frame 110: hands up and out to the lid; the pose reads as lifting.
- C6 HOLDS — one emitter in each scene, under the assets.

## Controls
- C18: pass 12 frame 110 (hard rectangle) and pass 08 frame 42 (hard toggle).

## Next
- The bubble (script §Resource vocabulary): a transmissive glass dome swelling from the box with the gadget inside, same material as the frame interior; needs a second `@remotion/three` canvas in beat 1.
- Beat 2 projection assets: stalks, arches, rings, patches as 2D silhouettes for the overwhelm.
- Run the scaffolded chain once on beats 4–5 as the trail.
