/**
 * The secondaries solver (D97): what trails a primary, derived from a material's declared motion instead of hand-written lags. A secondary bone is a Verlet chain (Jakobsen, "Advanced
 * Character Physics", GDC 2001) hung from the primary's joint: every point keeps a previous position, falls with gravity scaled by the material's mass, loses velocity to drag,
 * and is pulled back to its neighbour by distance constraints relaxed 4 passes per step. Stepped on ones (each frame is 4 substeps of a quarter frame), sampled on twos (`onTwos`).
 * Pure in its arguments: no DOM, no randomness, the same numbers on every run.
 *
 * The mapping from declaration to chain (the bench, scripts/animation/bench-materials.mjs, measures whether it holds):
 *  - Each free point is a damped spring toward its parent plus the bone's rest offset: `a = ω²(target − p) − (air + internal)·v + gravity`, which is a second-order
 *    system with damping ratio ζ = (air + internal) / 2ω. A chain of n points is n such systems in series, so the tip trails the anchor by roughly n stage delays (2ζ/ω each): that
 *    is where `lagFrames` comes from, a floor the chain must clear and not a number written into it.
 *  - `secondOrderOf` is the closed form that bridges settle and overshoot to one stage: ζ = −ln O / √(π² + ln² O) and ω = 4 / (ζ·S) (settling to 2 %). It is exact for one point
 *    and a seed for more: n stages overshoot more and settle later than one, and the settle the bench reads is a speed (0.5 % of 720 px per frame), not a 2 % band. So `designChain`
 *    keeps the seed's form and solves its two unknowns (ω, and the damping that is not air) on the linear chain for the declared step, for each n from 1 to MAX_POINTS, and takes
 *    the fewest points whose tip trails the anchor by the declared lag. The linear chain is this same stepper without constraints or gravity, so what is designed is what runs;
 *    what the constraints and gravity do to it is what the bench shows.
 *  - `drag` is the air part of the damping (velocity lost per frame, whatever moves); the rest of the damping a declaration needs is internal. A drag
 *    that alone exceeds what the declared settle and overshoot allow leaves the chain over-damped, and the bench refuses it.
 *  - `mass` and `stiffness` set the load gravity puts on the chain: gravity is G·mass·(1 − stiffness), with G = 4.36 px/frame² (9.8 m/s² for a 1.8 m figure drawn 720 px tall, at 30 fps).
 *    Stiffness is the share of that load the drawn shape holds: the blend toward the rest shape that Spine's "follow the unconstrained pose" gives, taken on the load and not on the swing,
 *    because a blend on the swing would cancel the lag the declaration asks for.
 */
import {spacingProfile} from './pose';
import type {Motion} from './materials';
import {quantise} from './track';

export type Vec = [number, number];

export const FPS = 30;
/** Substeps per frame: the chain is stepped on ones, each step a quarter frame (a frame at ω ≈ 1 rad/frame needs this for the integrator to follow the spring). */
export const SUBSTEPS = 4;
export const RELAX_PASSES = 4;
/** px per frame squared: 9.8 m/s² x 400 px/m (a 1.8 m figure drawn 720 px tall) / 30². */
export const GRAVITY_PX = 4.36;
export const FIELD_H = 720;
/** A secondary is at rest when its tip moves less than this per frame: 0.5 % of the 720 px field. */
export const REST_SPEED = 0.005 * FIELD_H;
export const MAX_POINTS = 6;
const WARM_FRAMES = 150;

// ---------- the closed form ----------

/** Damping ratio and natural frequency (rad/frame) of the one second-order system that overshoots by `overshoot` (0-1) and settles to 2 % in `settleFrames`. */
export const secondOrderOf = (settleFrames: number, overshoot: number): {damping: number; frequency: number} => {
  const damping = overshoot < 1e-6 ? 1 : -Math.log(overshoot) / Math.sqrt(Math.PI ** 2 + Math.log(overshoot) ** 2);
  return {damping, frequency: 4 / (damping * settleFrames)};
};

// ---------- the chain ----------

export type ChainParams = {
  /** Free points below the anchor. */
  points: number;
  /** Natural frequency of one stage, rad/frame. */
  frequency: number;
  /** Velocity lost to the air per frame (the material's drag). */
  air: number;
  /** Damping per frame on top of the air: the structure's own friction, so that air + internal = 2ζω of the stage. */
  internal: number;
  /** px/frame² downward: G x mass x (1 - stiffness). */
  gravity: number;
};

/** A straight bone hanging from the anchor: one link of `segment` px per chain point, along `direction` (default straight down, y down). */
export type Bone = {segment: number; direction?: Vec};

type Stage = {p: Vec; q: Vec};
type Chain = {params: ChainParams; offsets: Vec[]; lengths: number[]; stages: Stage[]; anchor: Vec};

const restOffsets = (bone: Bone, points: number): Vec[] => {
  const d = bone.direction ?? [0, 1], n = Math.hypot(d[0], d[1]) || 1, step = bone.segment / n;
  return Array.from({length: points}, () => [d[0] * step, d[1] * step] as Vec);
};

const startChain = (params: ChainParams, bone: Bone, anchor: Vec): Chain => {
  const offsets = restOffsets(bone, params.points);
  let at: Vec = anchor;
  const stages = offsets.map((o) => {
    at = [at[0] + o[0], at[1] + o[1]];
    return {p: at, q: at};
  });
  return {params, offsets, lengths: offsets.map((o) => Math.hypot(o[0], o[1])), stages, anchor};
};

/** One substep: every point is advanced by its spring, drag and gravity (Verlet: x' = x + (x - x_prev) + a dt²), then the distance constraints are relaxed. `constrained` false is the linear chain the design runs. */
const substep = (chain: Chain, anchorNow: Vec, dt: number, constrained: boolean): void => {
  const {params, offsets, lengths, stages} = chain;
  const k = params.frequency * params.frequency;
  let parent: Vec = anchorNow;
  stages.forEach((s, i) => {
    const o = offsets[i]!, before = s.p;
    const damping = params.air + params.internal, vx = (s.p[0] - s.q[0]) / dt, vy = (s.p[1] - s.q[1]) / dt;
    const ax = k * (parent[0] + o[0] - s.p[0]) - damping * vx;
    const ay = k * (parent[1] + o[1] - s.p[1]) - damping * vy + params.gravity;
    s.p = [s.p[0] + (s.p[0] - s.q[0]) + ax * dt * dt, s.p[1] + (s.p[1] - s.q[1]) + ay * dt * dt];
    s.q = before;
    parent = s.p;
  });
  chain.anchor = anchorNow;
  if (!constrained) return;
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    stages.forEach((s, i) => {
      const a = i === 0 ? anchorNow : stages[i - 1]!.p;
      const dx = s.p[0] - a[0], dy = s.p[1] - a[1], d = Math.hypot(dx, dy) || 1e-9, c = (d - lengths[i]!) / d;
      if (i === 0) s.p = [s.p[0] - dx * c, s.p[1] - dy * c];
      else {
        const above = stages[i - 1]!;
        above.p = [above.p[0] + dx * c * 0.5, above.p[1] + dy * c * 0.5];
        s.p = [s.p[0] - dx * c * 0.5, s.p[1] - dy * c * 0.5];
      }
    });
  }
};

/** One frame on ones: the anchor travels from where it was to `to` in SUBSTEPS substeps. */
const stepFrame = (chain: Chain, to: Vec, constrained: boolean): void => {
  const from = chain.anchor;
  for (let s = 1; s <= SUBSTEPS; s++) substep(chain, [from[0] + ((to[0] - from[0]) * s) / SUBSTEPS, from[1] + ((to[1] - from[1]) * s) / SUBSTEPS], 1 / SUBSTEPS, constrained);
};

/**
 * Every point of the chain on every frame for an anchor path (one position per frame): `result[f][i]` is point i on frame f, the last point the tip. The chain starts at rest under the first
 * anchor position and is run 150 frames at that position first, so gravity has set the sag the stiffness leaves before the path begins.
 */
export const runChain = (params: ChainParams, bone: Bone, anchor: Vec[], options: {constrained?: boolean} = {}): Vec[][] => {
  const constrained = options.constrained ?? true;
  const chain = startChain(params, bone, anchor[0]!);
  for (let f = 0; f < WARM_FRAMES; f++) stepFrame(chain, anchor[0]!, constrained);
  return anchor.map((a) => {
    stepFrame(chain, a, constrained);
    return chain.stages.map((s) => s.p);
  });
};

/** The drawn layer's view of a run: a frame shows the pose of the even frame at or before it (twos). */
export const onTwos = <T>(frames: T[]): T[] => frames.map((_, f) => frames[quantise(f)]!);

// ---------- measuring a response ----------

/** The primary a secondary is driven through: the anchor's x on each frame, the frame it stops on and how far it moved. */
export type Primary = {name: 'step' | 'impulse' | 'sine'; anchor: Vec[]; stop: number; amplitude: number};

const LEAD = 8, HOLD = 60;
const pathOf = (xs: number[]): Vec[] => xs.map((x) => [x, 0] as Vec);

/** The three canonical primaries: a step of 120 px over 1 frame then held 60; an impulse of 60 px out and back over 6 frames then held 60; a sine of 40 px amplitude, 12-frame period, 48 frames, then held 60. 8 frames of rest come first. */
export const PRIMARIES: Primary[] = [
  {name: 'step', amplitude: 120, stop: LEAD + 1, anchor: pathOf([...Array(LEAD).fill(0), ...Array(1 + HOLD).fill(120)])},
  {name: 'impulse', amplitude: 60, stop: LEAD + 6, anchor: pathOf([...Array(LEAD).fill(0), 20, 40, 60, 40, 20, 0, ...Array(HOLD).fill(0)])},
  {name: 'sine', amplitude: 40, stop: LEAD + 48, anchor: pathOf([...Array(LEAD).fill(0), ...Array.from({length: 48}, (_, t) => 40 * Math.sin((2 * Math.PI * (t + 1)) / 12)), ...Array(HOLD).fill(0)])},
];

/** Frames from the primary's stop to the last frame the tip moves faster than REST_SPEED. */
export const settleOf = (tip: number[], stop: number): number => {
  let last = stop;
  for (let f = stop + 1; f < tip.length; f++) if (Math.abs(tip[f]! - tip[f - 1]!) > REST_SPEED) last = f;
  return last - stop;
};

/**
 * The first return past rest as a fraction of the move: from the stop, the first stretch of frames in which the tip is beyond `rest` on the `sign` side, its largest excursion over `amplitude`.
 * A step rests at its end (rest = amplitude, sign +1); an impulse comes back to 0 and its first return is the swing below it (rest 0, sign -1).
 */
export const overshootOf = (tip: number[], stop: number, rest: number, sign: 1 | -1, amplitude: number): number => {
  let best = 0, inside = false;
  for (let f = stop; f < tip.length; f++) {
    const beyond = sign * (tip[f]! - rest);
    if (beyond > 0.1) {
      inside = true;
      best = Math.max(best, beyond);
    } else if (inside) break;
  }
  return best / amplitude;
};

/** Frames the tip trails the anchor: the shift (0 to `max`) at which they correlate best. A step has no shape to correlate (a plateau), so its velocities are used; the others use displacement. */
export const lagOf = (anchor: number[], tip: number[], useVelocity: boolean, max: number): number => {
  const d = (xs: number[]) => (useVelocity ? xs.map((x, i) => (i ? x - xs[i - 1]! : 0)) : xs);
  const a = d(anchor), t = d(tip);
  let best = -Infinity, lag = 0;
  for (let k = 0; k <= max; k++) {
    let sum = 0;
    for (let f = 0; f + k < t.length; f++) sum += a[f]! * t[f + k]!;
    if (sum > best + 1e-9) [best, lag] = [sum, k];
  }
  return lag;
};

/** snap, even or float from the spacing profile of the tip's slow-out: the frames it takes to go from its fastest frame to rest (4 or fewer snap, 10 or more float). */
export const easeClassOf = (tip: Vec[]): 'snap' | 'even' | 'float' => {
  const spacing = spacingProfile(tip);
  const peak = spacing.indexOf(Math.max(...spacing));
  let end = peak;
  spacing.forEach((s, i) => { if (i > peak && s > REST_SPEED) end = i; });
  const frames = end - peak;
  return frames <= 4 ? 'snap' : frames >= 10 ? 'float' : 'even';
};

export type Response = {
  primary: Primary['name'];
  /** Anchor and tip x displacement from rest, one value per frame. */
  anchor: number[];
  tip: number[];
  /** Tip y displacement from its rest position (the sag and swing under gravity). */
  tipY: number[];
  lag: number;
  settle: number;
  /** Null for the sine, which has no single move to overshoot. */
  overshoot: number | null;
  ease: 'snap' | 'even' | 'float';
};

export const respond = (params: ChainParams, bone: Bone, primary: Primary, options: {constrained?: boolean} = {}): Response => {
  const run = runChain(params, bone, primary.anchor, options);
  const tipPath = run.map((points) => points[points.length - 1]!);
  const rest = runChain(params, bone, [primary.anchor[0]!], options)[0]!.at(-1)!;
  const tip = tipPath.map((p) => p[0] - rest[0]);
  const anchor = primary.anchor.map((p) => p[0]);
  const useVelocity = primary.name === 'step';
  return {
    primary: primary.name,
    anchor,
    tip,
    tipY: tipPath.map((p) => p[1] - rest[1]),
    lag: lagOf(anchor, tip, useVelocity, primary.name === 'sine' ? 11 : 16),
    settle: settleOf(tip, primary.stop),
    overshoot: primary.name === 'step' ? overshootOf(tip, primary.stop, primary.amplitude, 1, primary.amplitude) : primary.name === 'impulse' ? overshootOf(tip, primary.stop, 0, -1, primary.amplitude) : null,
    ease: easeClassOf(tipPath.slice(primary.stop - 1)),
  };
};

// ---------- the design ----------

export type Design = ChainParams & {
  /** The seed: the one-stage closed form for the declared settle and overshoot. */
  seed: {damping: number; frequency: number};
  /** What the designed chain measures on the canonical step (the lag is the smaller of its step and impulse lags). */
  designed: {lag: number; settle: number; overshoot: number};
  /** True when the designed chain clears the declared lag and lands inside the tolerances the bench holds it to. */
  met: boolean;
};

const STEP = PRIMARIES[0]!, IMPULSE = PRIMARIES[1]!, SINE = PRIMARIES[2]!;
/** A 12-frame sine shows a delay unambiguously only below its half period; a declared lag from 6 up is read on the step and the impulse alone. */
export const SINE_HALF_PERIOD = 6;
/** What the bench holds a response to: settle within this many frames, overshoot within this fraction (lag only has a floor). */
export const TOLERANCE = {settle: 2, overshoot: 0.08};
const COST_FOR_LAG = 30;

type Fit = {params: ChainParams; lag: number; settle: number; overshoot: number; cost: number};

/** The chain itself (constraints and gravity included) through the step, and through the impulse when the step is close enough to be worth the second run. */
const fitOf = (params: ChainParams, bone: Bone, motion: Motion): Fit => {
  const step = respond(params, bone, STEP), overshoot = step.overshoot ?? 0;
  let cost = ((overshoot - motion.overshoot) / 0.03) ** 2 + (step.settle - motion.settleFrames) ** 2, lag = step.lag;
  if (cost < COST_FOR_LAG) {
    lag = Math.min(lag, respond(params, bone, IMPULSE).lag);
    if (motion.lagFrames < SINE_HALF_PERIOD) lag = Math.min(lag, respond(params, bone, SINE).lag);
    cost += Math.max(0, motion.lagFrames - lag) ** 2 * 4;
  } else cost += COST_FOR_LAG;
  return {params, lag, settle: step.settle, overshoot, cost};
};

const geometric = (lo: number, hi: number, n: number): number[] => Array.from({length: n}, (_, i) => lo * (hi / lo) ** (i / (n - 1)));

/** Frequency and total damping ratio of `points` stages that put the chain on the declaration: a coarse search from 0.12 to 3 rad/frame and 0.2 to 2.2, then two refinements around the best. */
const fitStages = (motion: Motion, bone: Bone, points: number, seed: {damping: number; frequency: number}): Fit => {
  const gravity = GRAVITY_PX * motion.mass * (1 - motion.stiffness);
  const attempt = (frequency: number, damping: number) => fitOf({points, frequency, air: motion.drag, internal: Math.max(0, 2 * damping * frequency - motion.drag), gravity}, bone, motion);
  let best = attempt(seed.frequency, seed.damping);
  for (const f of geometric(0.12, 3, 28)) for (const z of geometric(0.2, 2.2, 22)) { const a = attempt(f, z); if (a.cost < best.cost) best = a; }
  for (const span of [0.12, 0.03]) {
    const f0 = best.params.frequency, z0 = (best.params.air + best.params.internal) / (2 * f0);
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) { const a = attempt(f0 * (1 + (span * i) / 4), z0 * (1 + (span * j) / 4)); if (a.cost < best.cost) best = a; }
  }
  return best;
};

const designs = new Map<string, Design>();

/**
 * The chain a material's motion declares on a bone: the fewest points (1 to MAX_POINTS) whose tip trails the anchor by `lagFrames` on the step and the impulse and lands inside the settle and
 * overshoot tolerances of the step, with the frequency and damping that put it there (the file header says why the closed form is the seed and not the answer). Deterministic and cached.
 * When no point count meets the declaration the design is the one with the lowest cost among those that clear the lag (else the longest chain) and `met` is false.
 */
export const designChain = (motion: Motion, bone: Bone): Design => {
  const key = JSON.stringify([motion, bone]);
  const cached = designs.get(key);
  if (cached) return cached;
  const seed = secondOrderOf(motion.settleFrames, motion.overshoot);
  const ok = (f: Fit) => f.lag >= motion.lagFrames && Math.abs(f.settle - motion.settleFrames) <= TOLERANCE.settle && Math.abs(f.overshoot - motion.overshoot) <= TOLERANCE.overshoot;
  const fits: Fit[] = [];
  for (let n = 1; n <= MAX_POINTS && !fits.some(ok); n++) fits.push(fitStages(motion, bone, n, seed));
  const pick = fits.find(ok) ?? fits.filter((f) => f.lag >= motion.lagFrames).sort((a, b) => a.cost - b.cost)[0] ?? fits[fits.length - 1]!;
  const design: Design = {...pick.params, gravity: GRAVITY_PX * motion.mass * (1 - motion.stiffness), seed, designed: {lag: pick.lag, settle: pick.settle, overshoot: pick.overshoot}, met: ok(pick)};
  designs.set(key, design);
  return design;
};

/** The chain the closed form alone gives: one point at the seed's frequency, the drag as air and the rest of the seed's damping internal. What a solver without the design would run; the bench's control uses it. */
export const seedChain = (motion: Motion): ChainParams => {
  const seed = secondOrderOf(motion.settleFrames, motion.overshoot);
  return {points: 1, frequency: seed.frequency, air: motion.drag, internal: Math.max(0, 2 * seed.damping * seed.frequency - motion.drag), gravity: GRAVITY_PX * motion.mass * (1 - motion.stiffness)};
};

/** The tip of a chain for an anchor path, sampled on twos: the secondary as the drawn layer shows it. */
export const secondaryTip = (motion: Motion, bone: Bone, anchor: Vec[]): Vec[] => onTwos(runChain(designChain(motion, bone), bone, anchor).map((points) => points[points.length - 1]!));

/** The bench's measurement of one motion: the three canonical primaries through the designed chain. */
export const benchResponses = (params: ChainParams, bone: Bone): Response[] => PRIMARIES.map((p) => respond(params, bone, p));
