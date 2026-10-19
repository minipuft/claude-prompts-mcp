/**
 * The animation language as functions (creative-spec v4 §Animation language, D51).
 * Drawn layer: poses step on twos with hold / anticipation / action / overshoot / settle.
 * Light layer: continuous, damped, lagging the drawn layer. Nothing here is linear.
 * Every function is pure in `frame`, so a frame renders identically on every run.
 */
import {quantise, sample, type Breakdown} from './animation/track';

/** Quantize a frame to twos (or threes): the drawn layer only updates on these frames. */
export const onTwos = (frame: number, step = 2): number => quantise(frame, step);

export type Phases = {hold: number; anticipation: number; action: number; overshoot: number; settle: number};

/** House timing, in frames at 30 fps. Scale `action` for distance; keep the others. */
export const house: Phases = {hold: 12, anticipation: 4, action: 6, overshoot: 2, settle: 12};

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInQuad = (t: number) => t * t;

/**
 * One move from `from` to `to`, starting at `start`, shaped by the phases. Returns the value for `frame`.
 * Anticipation goes a little the other way; overshoot passes the target by `over` (fraction of the distance);
 * settle is a damped wobble back to `to`. The drawn layer should pass `onTwos(frame)`.
 */
export const move = (frame: number, start: number, from: number, to: number, phases: Phases = house, over = 0.08): number => {
  const d = to - from;
  const f = frame - start;
  if (f <= 0) return from;
  const {anticipation, action, overshoot, settle} = phases;
  if (f <= anticipation) return from - d * 0.06 * easeOutCubic(f / anticipation);
  const a = f - anticipation;
  if (a <= action) return from - d * 0.06 + d * (1 + over + 0.06) * easeInQuad(a / action);
  const o = a - action;
  if (o <= overshoot) return to + d * over;
  const s = o - overshoot;
  if (s <= settle) {
    const t = s / settle;
    return to + d * over * Math.cos(t * Math.PI * 1.5) * (1 - t) * (1 - t);
  }
  return to;
};

/** Total frames a `move` occupies, for sequencing the next actor after it. */
export const moveLength = (phases: Phases = house): number => phases.anticipation + phases.action + phases.overshoot + phases.settle;

/** Stagger: the n-th related element starts `gap` frames after the first (law 1: 3–5 frames). */
export const stagger = (start: number, n: number, gap = 4): number => start + n * gap;

/**
 * Boil: pick one of `variants` fixed contour variants for this frame, changing about `rate` times per second.
 * Seeded by `seed` so the sequence is fixed; this is boil, not shimmer (rubric C13 vs C16).
 */
export const boil = (frame: number, variants: number, seed: number, fps = 30, rate = 4): number => {
  const slot = Math.floor((frame * rate) / fps);
  let x = (slot * 374761393 + seed * 668265263) | 0;
  x = (x ^ (x >>> 13)) * 1274126177;
  x = x ^ (x >>> 16);
  return Math.abs(x) % variants;
};

/**
 * Lag: the light layer reads the drawn layer's value from `lagFrames` ago, then relaxes toward it with memory.
 * `valueAt` must be pure in frame. Returns a damped follower, so an impulse propagates and recovers without snapping (law 4, 5).
 */
export const lag = (frame: number, valueAt: (f: number) => number, lagFrames = 3, stiffness = 0.18): number => {
  // integrate a critically damped follower from frame 0; cost is linear in frame, fine for 30 s films
  let v = valueAt(0);
  let vel = 0;
  for (let f = 1; f <= frame; f++) {
    const target = valueAt(Math.max(0, f - lagFrames));
    const accel = (target - v) * stiffness - vel * 2 * Math.sqrt(stiffness);
    vel += accel;
    v += vel;
  }
  return v;
};

/** Seam pulse: a join reads as one bright pulse at the seam that decays, never a fade-in (law: world layer). */
export const seamPulse = (frame: number, at: number, length = 14): number => {
  const f = frame - at;
  if (f < 0 || f > length) return 0;
  const t = f / length;
  return Math.sin(Math.PI * Math.min(1, t * 3)) * (1 - t) * (1 - t);
};

/** A named set of 2D joint positions (mesh-rig pins), in whatever space the rig is authored in. */
export type Joints = Record<string, [number, number]>;
/** A drawn key pose. `hold`: frames the pose is kept before the move to the next key may begin. */
export type PoseKey = {frame: number; joints: Joints; hold?: number};
export type {Breakdown};
/**
 * A secondary: `joints` follow the pose they would have `frames` earlier (`frames` is a whole number of drawings on twos), so a poncho tip or a hand trails the body
 * and arrives after it (follow-through / overlap). `stretch` (0-1, default 0) says how the part trails. At 0 it RIDES its parent: it keeps the bone it had in the
 * earlier pose (length and direction) hung on the parent as placed now, so the parent's travel carries it and only its angle is late; a hand does this. At 1 it STAYS
 * where it was in the world and the bone stretches to reach it, which cloth can do and a forearm cannot; between, the two are mixed. A part that stayed put in the world
 * while its parent jumped swung opposite to the parent's sideways travel and left the kinks the arc probe reads as a zigzag (probe-inbetweens, rule a).
 */
export type PoseLag = {joints: string[]; frames: number; stretch?: number; /** Frame windows [from, to) in which the part does not lag: it moves with the body (a lead arm on the move it leads). */ off?: [number, number][]};
/**
 * A secondary derived from a material (animation/secondaries.ts) instead of delayed by hand: for each joint, how far the material's chain draws it from where riding its primary would put it,
 * one value per frame from `from` (key-sheet px, built on twos). `world` is the joint's own path filtered by the material (the part stays where the body left it, the bone stretches to reach it),
 * `rel` the joint's bone vector from its parent filtered by it (the part rides its parent and only its angle is late); `stretch` (0-1) mixes the two as it does for `PoseLag`. `virtual`: a joint
 * the rig does not have (a ponytail's tip), placed at `offset` (in the frame of the `away` -> `at` bone, up being 0) from joint `at` on every frame, then displaced like any other.
 * `off`: frame windows [from, to) in which the part does not follow (a lead arm on the move it leads; a cloak that has dropped and is a prop).
 */
export type PoseFollow = {
  joints: string[];
  from: number;
  stretch: number;
  world: Record<string, [number, number][]>;
  rel: Record<string, [number, number][]>;
  virtual?: {name: string; at: string; away: string; offset: [number, number]};
  off?: [number, number][];
};
/** A moving hold: from `from` (inclusive) to `to` (exclusive) every joint is shifted by `offset(frames since from)`. */
export type PoseDrift = {from: number; to: number; offset: (since: number) => [number, number]};
/** `breakdowns[].value`, when set, is the full drawing the breakdown shows (see `Breakdown`); `lags`, `follows` and `drifts` are the pose pass (animation/pose.ts) and absent from older charts. */
export type PoseChart = {keys: PoseKey[]; breakdowns?: Breakdown<Joints>[]; lags?: PoseLag[]; follows?: PoseFollow[]; drifts?: PoseDrift[]};

const wrapPi = (a: number) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

/**
 * The pose a fraction `t` of the way from `a` to `b`. Without `parents` each joint moves in a straight line. With `parents` (child -> parent)
 * each bone is interpolated by length and angle about its parent, so a limb swings through an arc and keeps its length instead of
 * shortening along the chord (a 133 degree arm raise cut to a third would otherwise fold the arm to 40% of its length).
 */
export const blendPose = (a: Joints, b: Joints, t: number, parents?: Record<string, string>): Joints => {
  const out: Joints = {};
  const place = (name: string): [number, number] => {
    const done = out[name];
    if (done) return done;
    const from = a[name]!, to = b[name] ?? from;
    const parent = parents?.[name];
    let placed: [number, number];
    if (parent && a[parent] && b[parent]) {
      const base = place(parent);
      const va = [from[0] - a[parent][0], from[1] - a[parent][1]], vb = [to[0] - b[parent][0], to[1] - b[parent][1]];
      const len = Math.hypot(va[0]!, va[1]!) * (1 - t) + Math.hypot(vb[0]!, vb[1]!) * t;
      const aa = Math.atan2(va[1]!, va[0]!);
      const ang = aa + wrapPi(Math.atan2(vb[1]!, vb[0]!) - aa) * t;
      placed = [base[0] + len * Math.cos(ang), base[1] + len * Math.sin(ang)];
    } else {
      placed = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    }
    out[name] = placed;
    return placed;
  };
  for (const name of Object.keys(a)) place(name);
  return out;
};

/**
 * Pose-to-pose (D72): the joint positions at `frame` from a timing chart. The drawn layer steps on twos (`onTwos`); between two keys the pose
 * is held, then jumps to a breakdown at 1/3 or 2/3 of the way, then lands on the next key. A key's `hold` delays the first move. A segment
 * with no authored breakdown gets two, at a third and two thirds of the way from the end of the hold to the next key; breakdowns are
 * authored in `chart.breakdowns` (only those between the two keys count). No half easing: the pose is never the midpoint unless authored so.
 * Pure in (chart, frame); `parents` is optional and only changes how a breakdown is blended (see `blendPose`).
 */
export const poseAt = (chart: PoseChart, frame: number, parents?: Record<string, string>): Joints => {
  if (!chart.keys.length) throw new Error('poseAt: a chart needs at least one key');
  const keys = chart.keys.map((k) => ({frame: k.frame, value: k.joints, hold: k.hold}));
  const at = (f: number): Joints => sample({keys}, f, {quantise: 'twos', lerp: (a, b, t) => blendPose(a, b, t, parents), breakdowns: chart.breakdowns ?? []});
  const primary = at(frame);
  if (!chart.lags?.length && !chart.follows?.length && !chart.drifts?.length) return primary;
  return drifted(chart, frame, followed(chart, frame, primary, lagged(chart, frame, primary, at, parents), parents));
};

/** The joint a `virtual` secondary adds, on a pose: `offset` from `at`, turned with the `away` -> `at` bone from straight up. */
export const virtualJoint = (v: NonNullable<PoseFollow['virtual']>, pose: Joints): [number, number] => {
  const at = pose[v.at], away = pose[v.away];
  if (!at || !away) throw new Error(`poseAt: virtual joint "${v.name}" needs joints "${v.at}" and "${v.away}"`);
  const turn = Math.atan2(at[0] - away[0], away[1] - at[1]), c = Math.cos(turn), s = Math.sin(turn);
  return [at[0] + v.offset[0] * c - v.offset[1] * s, at[1] + v.offset[0] * s + v.offset[1] * c];
};

/**
 * The pose with each derived secondary (`PoseFollow`) drawn where its material puts it: `rigid` is the parent as drawn now plus the joint's bone as the pose has it, shifted by the filtered bone's
 * displacement; `stayed` the joint's own place shifted by its filtered path's displacement; the joint is `rigid` at stretch 0 and `stayed` at stretch 1. Parent-first order. Before a follow's first
 * frame it has not started (no displacement); past its last it holds the last value.
 */
const followed = (chart: PoseChart, frame: number, rode: Joints, drawn: Joints, parents?: Record<string, string>): Joints => {
  if (!chart.follows?.length) return drawn;
  const out: Joints = {...drawn}, primary: Joints = {...rode};
  for (const follow of chart.follows) {
    const v = follow.virtual;
    if (v) out[v.name] = primary[v.name] = virtualJoint(v, primary);
    if (follow.off?.some(([from, to]) => frame >= from && frame < to)) continue;
    const i = Math.min(frame - follow.from, (follow.world[follow.joints[0]!] ?? follow.rel[follow.joints[0]!])!.length - 1);
    if (i < 0) continue;
    for (const name of [...follow.joints].sort((p, q) => depthOf(p, parents) - depthOf(q, parents))) {
      const cur = primary[name], parent = v?.name === name ? v.at : parents?.[name];
      if (!cur) continue;
      const w = follow.world[name]?.[i] ?? [0, 0], r = follow.rel[name]?.[i] ?? [0, 0];
      const stayed: [number, number] = [cur[0] + w[0], cur[1] + w[1]];
      const base = parent ? out[parent] : undefined, baseNow = parent ? primary[parent] : undefined;
      if (!base || !baseNow) {
        out[name] = stayed;
        continue;
      }
      const rigid: [number, number] = [base[0] + cur[0] - baseNow[0] + r[0], base[1] + cur[1] - baseNow[1] + r[1]];
      out[name] = [rigid[0] + (stayed[0] - rigid[0]) * follow.stretch, rigid[1] + (stayed[1] - rigid[1]) * follow.stretch];
    }
  }
  return out;
};

const depthOf = (name: string, parents?: Record<string, string>): number => {
  let d = 0;
  for (let p = parents?.[name]; p; p = parents?.[p]) d++;
  return d;
};

/**
 * The pose with each secondary's joints as they were `lag.frames` earlier, see `PoseLag`: `rigid` is the earlier bone hung on the parent as placed now, `stayed` the earlier
 * position itself, and the joint is `rigid` at stretch 0 and `stayed` at stretch 1. Parent-first order; a joint with no parent takes the earlier position outright.
 */
const lagged = (chart: PoseChart, frame: number, primary: Joints, at: (f: number) => Joints, parents?: Record<string, string>): Joints => {
  const out: Joints = {...primary};
  for (const lag of chart.lags ?? []) {
    if (lag.off?.some(([from, to]) => frame >= from && frame < to)) continue;
    const earlier = at(frame - lag.frames);
    for (const name of [...lag.joints].sort((p, q) => depthOf(p, parents) - depthOf(q, parents))) {
      const prev = earlier[name], cur = primary[name], parent = parents?.[name];
      if (!prev || !cur) continue;
      const base = parent ? out[parent] : undefined, baseNow = parent ? primary[parent] : undefined;
      if (!base || !baseNow) {
        out[name] = prev;
        continue;
      }
      const prevBase = earlier[parent!] ?? baseNow, stretch = lag.stretch ?? 0;
      const rigid: [number, number] = [base[0] + prev[0] - prevBase[0], base[1] + prev[1] - prevBase[1]];
      out[name] = [rigid[0] + (prev[0] - rigid[0]) * stretch, rigid[1] + (prev[1] - rigid[1]) * stretch];
    }
  }
  return out;
};

const drifted = (chart: PoseChart, frame: number, pose: Joints): Joints => {
  const f = quantise(frame, 2);
  const drift = (chart.drifts ?? []).find((d) => f >= d.from && f < d.to);
  if (!drift) return pose;
  const [dx, dy] = drift.offset(f - drift.from);
  return Object.fromEntries(Object.entries(pose).map(([n, p]) => [n, [p[0] + dx, p[1] + dy] as [number, number]]));
};
