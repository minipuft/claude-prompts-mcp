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

## Tooling: how a property is enforced once it exists (draft 2026-10-18)

| Tool | What it enforces | When it runs | Control |
| --- | --- | --- | --- |
| `materials.schema.json` + `src/library/animation/materials.ts` importing `v3/materials.json` with `satisfies Record<MaterialId, Material>` | every property present, typed and in range at compile time; a new property is a type change the compiler sees everywhere it is read | `npm run typecheck` (already on pre-push) | an out-of-range or missing field fails typecheck |
| `scripts/animation/probe-materials.py` | ranges and cross-rules in plain words: a transmissive material declares refraction and diffusion; an emissive one has albedo 1; cloth has stiffness below 0.3; nothing declares a lag with no settle | the pose gate and `npm run bible` (materials.json becomes a bible input) | planted: cloth with stiffness 1 refused |
| `scripts/animation/bench-materials.mjs` → `v3/materials-bench.json` + `out/materials-bench.html` | the declared numbers against the measured ones: every material is driven through three canonical primaries (a step, an impulse, a 12-frame sine) and the solver's response is measured; lag, settle, overshoot and ease class are read off the curves and compared with the declaration; the page shows one strip per material | on any change to materials.json or the solver | planted: a declared lag of 6 with a solver that gives 2 refused |
| `scripts/animation/probe-followthrough.py` | the same measurements on rendered frames of a real shot (the primary's and secondary's tracked points) | the pose gate | planted: a secondary settling before its primary refused |
| `scripts/animation/fit-material.py <frames> --primary x,y --secondary x,y` | proposes values from a reference clip: tracks two points, measures lag by cross-correlation, settle by energy, overshoot by first return; writes a proposal of kind inspiration with the fitted numbers and the clip as reference | when the owner files a movement reference | planted: two identical signals give lag 0 and are reported as such |
| render manifest and the bible hash | a changed material stales every layer and page that read it | every render and rebuild | existing manifest and bible controls |
| the bible page: a materials table (not a lane; materials are not timed) with inline edit through the server's `/edit file:'materials'` | the owner changes a value where its effects are shown; a change is a proposal of kind change until graded | edit mode | the server restores a value the probe refuses |
| the inspiration schema: `material.*` facets | a reference can be filed for how a thing moves (snap, float, weighted, drape) and `check-provenance` requires them on a pick cited by a material | `eagle_board.py pick --facet` | a pick cited by materials.json with no material facet fails `ledger` |

## Formulas and algorithms: how the goals are reached in numbers

**Motion (G1, G2, G5)**

- *Verlet integration with constraint relaxation* (Jakobsen, "Advanced Character Physics", GDC 2001): `x' = x + (x − x_prev)·(1 − drag) + a·dt²`, then each segment pulled back to its rest length over a few relaxation passes. Deterministic at a fixed step, stable under large steps, and the algorithm under Spine's physics constraint and every cloth demo. Stepped on ones, sampled on twos.
- *Second-order system as the declaration's bridge*: a material's `settleFrames` S and `overshoot` O map to a damped spring's damping ratio and natural frequency in closed form: `ζ = −ln O / √(π² + ln² O)` and `ω = 4 / (ζ · S)` (settling to 2 %). The solver's damping and stiffness are derived from the declaration, never tuned by hand; the bench confirms the round trip.
- *Lag as a measurement*: the delay between primary and secondary is the argmax of their cross-correlation over the move; it must be at least `lagFrames`. The declaration is a floor the physics must clear; the bench and the probe read the same number.
- *Stiffness as a mix toward the rest pose*: each step blends the chain toward its drawn rest shape by `stiffness` (Spine's "follow the unconstrained pose" slider), so hair keeps its swoop and cloth does not.
- *Contact with volume preserved*: at a contact key the primary squashes by `s` along the contact normal and stretches by `1/√s` across it (area preserved in 2D), then a settle breakdown of `contact` frames follows; the arc and hold probes already measure the breakdown.
- *Spacing on twos*: slow-in and slow-out as a timing chart `s_i = (1 − cos(π·i/n)) / 2`, with favouring by a power term; the spacing-profile probe already reads it. A derived secondary with constant spacing is refused as simulated.
- *Arcs*: a breakdown's position lies on a circular arc through the two keys with sagitta `k · chord`; the arc-deviation probe already measures it.
- *Moving holds and boil*: a hash noise keyed on (role, ⌊frame/2⌋) gives a drift and a line wobble that changes on twos and is byte-identical across runs; amplitude from `boil` and the moving-hold band.

**Light (G4)**

- *Jump flooding* (Rong and Tan, 2006): a signed-distance field from the occluder mask in log₂(width) full-screen passes, deterministic, on the GPU quad we already render.
- *Soft shadow by sphere-tracing* (Quilez): march from the pixel toward the emitter through the field; the penumbra is `min(k · h / t)` over the march, with `k` from the material's shadow class; a solid occluder returns 0 when the field is hit, a transmissive one skips the hit and sends the pixel to the glass pass.
- *Falloff as a volume*: the emitter's intensity falls with distance through the field, clamped at the floor the light script already declares, so the eye-trace probe keeps the brightest pixels at the emitter.
- *One bounce*: lit occluder edges become weak emitters scaled by `albedo`, sampled with the same march; this is radiance cascades at its first level, enough for one emitter per shot. The full cascade (probes whose spacing and direction count double per level) is the trial if a shot ever needs more.
- *Light with memory*: the emitter's effective position and intensity follow their targets through a first-order low-pass `L_t = L_{t−1} + (1 − e^{−1/τ})·(target − L_{t−1})` with τ from the light material's lag; the lag chain already does this.
- *Dither, not ramps*: the light buffer is quantised by a fixed blue-noise texture thresholded per shadow class (ordered dither is the fallback); the shadow probe reads a two-peaked histogram, never a ramp.
- *Glass*: displacement by the field's gradient scaled by `refraction`, softened by a separable blur scaled by `diffusion`; already built, reading constants that become the material's numbers.

**Measurement (every goal)**: peaks by local maxima of displacement, settle by the energy of the chain falling below a threshold, lag by cross-correlation, spacing by consecutive differences, arcs by sagitta, light by the brightest-pixel centroid and the far-side mean. Each has a planted control that must trip before the real check reports.
