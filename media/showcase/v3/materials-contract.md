# The material contract: what each property does, what it is for, how it is reached and measured

Draft 2026-10-18 for proposals p002 and p003. Reads with the creative spec (D47, D48, D51, D72, D83, D88, D91, D92) and the rubric (C14, C28, C31–C33). Nothing here is ruled yet.

## The five goals the properties serve

| Goal | What the viewer should feel | The reference that shows it | How we know we reached it |
| --- | --- | --- | --- |
| G1 Weight | a body lands, then settles; cloth settles after the body; a step has mass | Totoro (weight on contact), the heel tap in Spirited Away | the follow-through probe: every secondary settles after its primary by its declared lag, never before |
| G2 Nothing arrives at once | hair, cloak, hands, light and glass each arrive on their own frames | the twelve principles (follow-through and overlapping action); CalArts holds | the overlap measure already in probe-inbetweens: no two secondaries share the same lag; a move whose parts all stop on one frame is refused |
| G3 A lived-in world | what moved stays moved; a heap of cloak remains; a nudged piece drifts back slowly | Ghibli's "details only a child would notice" | the bible's look lane: a state flipped by an action persists until a later action flips it; the probe refuses a flip that reverts with no action |
| G4 Light as a volume | the emitter owns the brightest pixels; things between it and the field cast a soft shadow; lit edges warm what is near them | Turrell, the Seuss black field, Midnight Gospel's dither | eye-trace (already passing) plus the occlusion control: a planted occluder darkens the far side |
| G5 Drawn, not simulated | spacing eases, holds move, lines boil, shadows are stipple | D51 drawn on twos, D52 boil, D48 dither | the existing twos/ones, hold-band and arc probes keep passing with the derived secondaries on; a derived secondary that is evenly spaced is refused |

## The properties

Each property is a number in `v3/materials.json`, read by the secondaries solver (motion), the light layer (radiance) or both. "Reached by" names the mechanism; "measured by" names the probe line and its control.

| Property | What it does on screen | Goal | Reached by | Measured by (probe · control) |
| --- | --- | --- | --- | --- |
| `mass` | how hard a secondary falls and how far it swings when its primary stops | G1 | gravity term of the Verlet chain scales with it | follow-through: swing amplitude at the primary's stop grows with mass · control: mass 0 gives no swing and is refused for cloth |
| `lagFrames` | how many frames the secondary trails its primary | G1, G2 | the chain's anchor follows the primary; the chain's own inertia produces the delay; the value is the floor the solver must meet | follow-through: measured delay between primary peak and secondary peak ≥ lagFrames · control: a chain with drag 1 (no delay) is refused |
| `settleFrames` | how long after the primary stops the secondary keeps moving before it rests | G1 | damping chosen so the chain's energy falls below the rest threshold at settleFrames | follow-through: last frame with motion above 0.5 % of H lands within ±2 of settleFrames · control: a settle of 0 frames refused |
| `overshoot` | how far past its rest the secondary swings before coming back (fraction of the move) | G1, G5 | the chain's first return amplitude; clamped so the silhouette probe still accepts the pose | arc probe: one declared overshoot per move, within band · control: two overshoots (a bounce) refused |
| `drag` | how much the secondary resists the air; high drag means slow, floaty, low means snappy | G2 | velocity damping per step | spacing profile: the secondary's ease-out length matches the drag class (snap, even, float from the acting facets) · control: a floaty cloth on a snap move refused |
| `stiffness` | how much the chain holds its drawn shape against gravity (hair holds a swoop; cloth does not) | G5 | a shape constraint toward the rest pose, Spine's "follow the unconstrained pose" slider | silhouette: the lead side keeps its declared silhouette kind at the hold · control: stiffness 0 on hair loses the swoop and is refused |
| `contact` | at a contact (foot, hand, body on patch) the primary squashes and the secondaries settle later | G1 | the pose step inserts a settle breakdown of `contact` frames after any contact key | hold-band and breakdown probes: a contact key is followed by a settle breakdown · control: a contact with no settle refused |
| `boil` | the line's wobble amplitude per material (paper and crayon boil more than box and glass) | G5 | the boil pass reads the amplitude per role | boil measure in the render probe: amplitude per material inside its band · control: amplitude 0 on crayon refused |
| `shadowClass` | which stipple scale the material's shadow uses (two-scale dither) | G4, G5 | `Dither.tsx` picks the stipple by class | shadow probe: the shadow region is stipple, not a ramp (histogram has two peaks) · control: a smooth ramp refused |
| `occluder` | solid, transmissive or emissive: whether the material blocks, bends or gives light | G4 | the occluder mask fed to the jump-flood field; transmissive goes to the glass pass; emissive adds to the light buffer | occlusion control: a planted solid between emitter and field darkens the far side; a transmissive does not · control: a solid that does not darken refused |
| `albedo` | how much of its own hue a lit edge gives back to what is near it (the bounce) | G4 | the one-level bounce samples lit edges as weak emitters scaled by albedo | colour continuity: bounce colour stays inside the pair; eye-trace: the emitter stays brightest · control: albedo above 1 makes an edge brighter than the emitter and is refused |
| `refraction`, `diffusion` | how much what is behind the material is displaced and softened | G4 | the glass pass (already built, D45) reads them instead of constants | glass probe: edge displacement within the declared range · control: refraction 0 on glass reads as a flat picture and is refused (D45) |

## The materials, first values (to be graded on beat 4 and the art world)

| Material | mass | lag | settle | overshoot | drag | stiffness | contact | boil | shadow | occluder | albedo | refr/diff |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cloth (the cloak) | 1.0 | 6 | 14 | 0.18 | 0.12 | 0.1 | 6 | 1.0 | stipple-2 | solid | 0.25 | – |
| hair (the swoop) | 0.6 | 4 | 10 | 0.25 | 0.10 | 0.6 | – | 1.2 | stipple-1 | solid | 0.2 | – |
| body (the human's limbs) | 1.0 | 0 | 8 | 0.10 | – | 1.0 | 8 | 1.0 | stipple-2 | solid | 0.3 | – |
| box | 2.0 | 0 | 4 | 0.05 | – | 1.0 | 4 | 0.5 | stipple-2 | solid | 0.15 | – |
| glass (frame interior, bubble) | 0.3 | 2 | 6 | 0.05 | 0.3 | 0.9 | – | 0.3 | none | transmissive | 0.0 | 0.6 / 0.4 |
| light (emitter) | – | 3 (the lag chain) | 10 | 0 | – | – | – | 0 | none | emissive | 1.0 | – |
| paper (crayon world) | – | – | – | – | – | – | – | 1.6 | stipple-3 | solid | 0.4 | – |
| line (crossing world) | – | 2 | 6 | 0 | 0.2 | 0.8 | – | 1.4 | none | solid | 0.1 | – |

## How we get there, in order

1. Write `v3/materials.json` from the table and the schema from the property list; the inspiration schema gains `material.*` facets so a reference can be filed for how a thing moves.
2. The secondaries solver (a fixed-step Verlet chain per secondary bone, stepped on ones, sampled on twos) replaces the hand-written lags in the pose sheets; `poseChartFrom` reads the material of each secondary. Beat 4's cloak and heel tap are the first use.
3. `probe-followthrough.py` with the controls in the table joins `animation-pose-contract`.
4. The light layer (p003) reads `occluder`, `albedo`, `shadowClass`; the occlusion control joins the render probes; the glass pass reads `refraction` and `diffusion`.
5. Each first value is graded by eye on the beat-4 pose chart and the art-world study and written back as a ruling; a value the owner changes on the bible page is a proposal of kind change.

What is not a property: colour (the five roles own it), silhouette (the pose sheet owns it), timing of the primary (the key sheet owns it). A material never moves a primary.
