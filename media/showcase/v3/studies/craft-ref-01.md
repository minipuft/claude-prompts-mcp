# craft-ref-01 — CalArts reference set and what it measures (2026-10-13)

Owner asked for convincing that the 2D path reaches the D72 baseline. This study pulls two 2025 award films and measures what they do, frame by frame.

## Reference set (`v3/references/calarts/`, 480p, local study copies only)

| File | Film | Award | Why it is here |
|---|---|---|---|
| `continue-2025.mp4` | *Continue?* by Zechen Wang, 4:07 | 2025 Walter and Gracie Lantz Animation Prize | two-register film: flat domestic scenes and a stylised game world; flat fills, one shadow tone, uniform thin contour |
| `giant-crush-2025.mp4` | *GIANT CRUSH* by Luke Lee, 4:07 | 2025 Procreate Award | strong line of action, heavy camera moves, graphic colour scripts per scene |
| `producers-show-2025.mp4` | 70 s event reel | | mostly stage footage, kept for the three film excerpts |

Not retrieved: *MAMALONACITAS* (Peers' Pick) is not on YouTube under its title. The 2026 cohort playlist (`PL1lT7OF9iYNsYC3Hw-M-vjo5Ree3R4vyh`) lists twelve more films if the owner wants a wider set. Contact sheets: `*-contact.png` (one frame per 3 s). Strips: `*-strip-*.png` (24 consecutive frames).

## Measured cadence (distinct frames per 4 s beat, 24 fps; a camera move counts every frame as distinct, so the real drawing count is lower)

| Beat | frames | distinct | hold-length histogram (frames → count) |
|---|---|---|---|
| Continue? 0:50 sword lunge | 96 | 39 | 1×29, 2×4, 3–6×4, 14×1, 27×1 |
| Continue? 2:00 | 96 | 55 | 1×41, 2×5, 4×6, 7×1, 11×1 |
| Continue? 3:12 fight | 96 | 54 | 1×42, 2×5, 3–6×5, 9×1, 13×1 |
| GIANT CRUSH 1:02 push-in on the point | 96 | 81 | 1×73, 2×5, 3×2, 7×1 (camera on ones) |
| GIANT CRUSH 2:55 | 96 | 80 | 1×68, 2×8, 3×4 (camera on ones) |
| GIANT CRUSH 3:50 | 96 | 60 | 1×54, 2×2, 5×1, 7×1, 23×1 |

What the histogram says: the acting is **pose-to-pose with long holds (11–27 frames) and short bursts of ones** at the transition, not steady twos. A move is 3–6 drawings including a smear, then a hold. That is exactly the D72 chart vocabulary (key, breakdown, smear, hold), and nothing in it needs a rig that interpolates smoothly for long stretches.

## What reads as "CalArts" in these two, as rubric terms

1. **One contour weight everywhere**, thin, same colour family as the fill's shadow, no line boil (C22 clean-up standard holds; our 1/120 figure height is in range).
2. **Flat fills, one shadow tone, no gradients on characters**; the mood is carried by the background colour script per scene (GIANT CRUSH goes orange → magenta → violet across three acts). Our two-layer black-field medium is simpler than either film; that is a choice, not a gap.
3. **Big simple shapes**: head mass, torso mass, one clean limb taper; hands are mitten-simple except on the key that needs fingers.
4. **Line of action on every key**, silhouette readable filled black (C21).
5. **Holds are not frozen**: the held drawing often gets a 2-frame eye or mouth change mid-hold.
6. **Camera does the fluidity**: GIANT CRUSH's "fluid" feeling in the measured beats is the camera push on ones over held or slow drawings, not drawn ones. Remotion gives this for free.

## Verdict on the owner's question

The things these films do that our path cannot yet do are: connected limbs between keys (rig, tech-rig-02), a smear drawing on the big move (a generated key under D72), and eye or mouth changes inside a hold (face states already exist, D70). Nothing measured here requires 3D or per-frame drawing. The things 3D would give (smooth long interpolation) are not present in the reference; long interpolation reads as the opposite of this look.

## Open to the owner

- Favourite references from the Eagle library: a folder export or paths; they go next to these under `references/owner/` and get the same contact sheet and cadence measure.
