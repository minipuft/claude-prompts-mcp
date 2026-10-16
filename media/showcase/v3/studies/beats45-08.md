# Beats 4–5 pass 08 — first moving proof under the animation language (D51)

Rendered 2026-10-07: [clip](beats45-08.mp4) 8 s, 240 frames, 1280x720; [raise strip, frames 30/34/38/42/46](beats45-08-raise-strip.png); [join strip, frames 142–158](beats45-08-join-strip.png). Graded against rubric v1.2.

## Changed

- `library/motion.ts` (new): onTwos, move with hold/anticipation/action/overshoot/settle, stagger, seeded boil, lagging damped follower, seamPulse.
- `scenes/Beats45.tsx` (new): Clawd's raise as one phased move on twos with contour boil; the radiance lags the raise on ones; beat 5 slides towerA in and raises the second stalk, staggered, each with a seam pulse.
- `cast/Clawd.tsx`: boil variants nudge the contour group; arm rests at the side at raise 0.
- `glass/FrameInterior.tsx`: joinA/joinB/pulseA/pulseB props.

## Grades

- C16 HOLDS — per-frame change in Clawd's region during the raise: 29.4 % at 30, 0.02 % at 31, 22.3 % at 32, 0.19 % at 33, 34.2 % at 34, 0.10 % at 35; the drawn layer updates on even frames only. Same for join A inside the frame: 6.6 % at 146, 0.22 % at 147, 3.8 % at 150, 0.25 % at 151.
- C17 HOLDS — join B starts after join A's move length plus a 5-frame stagger; no two unrelated elements start on one frame.
- C18 HOLDS for the lag, FAILS for the mask — the light region changes every frame from 32 to 41 while the drawn layer steps, so light runs on ones and lags; but the radiance mask snaps on at `light > 0.5` (frame 42: field change drops from 56 % to 0.45 % in one frame), which is a toggle, not a recovery. The seam pulses are not visible (see C6).
- C14 HOLDS as a first reading — raise strip: rest, anticipation dip, swing, overshoot, settle read without text.
- C13 HOLDS — boil alternates fixed variants; stipple static between variant changes.
- C6 FAILS — emitter rim and seam pulses still invisible through the transmission pass.
- C10 FAILS — the frame rises from below Clawd and crosses his body on frames 30–38; the tool should enter from the raised hand's side, not through the actor.
- C12 UNPROVEN this pass — not re-hashed.

## Controls

- C16/C17/C14 have no earlier moving control; beat4-seuss-07 moved only the arm linearly.

## Owner

1. TASTE — boil amplitude is about one pixel at 2.2x scale. Keep subtle (default), or push toward The Midnight Gospel's visible line wobble?

## Next

- C18: replace the mask toggle with a continuous one: outside-the-frame radiance intensity follows `1 - light` through the lag, mask edge feathered.
- C6: render emitter rim and seam pulses on a 2D radiance layer in front of the glass, masked to the frame, so they are not lost in transmission.
- C10: frame enters from above-right of the raised hand; Clawd's body never occluded.
- C12: hash frame 120 twice.
