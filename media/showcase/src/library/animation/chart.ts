/**
 * Timing charts: the motion contract of one shot (v3/charts/<shot>.json), the step before the key sheet. The chart is data a renderer reads, never a
 * description a renderer interprets: every actor is either a rig driven by a key sheet (named keys, holds, breakdowns) or a scalar track (a lid angle,
 * a bubble's size, a lean) on twos; related starts are staggered; the light layer lags the drawn layer; the camera follows the layout.
 *
 * Pure in (chart, frame). Nothing here imports the cast, the worlds or the props (scripts/animation/check-boundary.mjs).
 */
import {applyEase, sample, type Breakdown, type Ease, type Track} from './track';

export type ChartKey = {name: string; frame: number; hold?: number; pose: string; lineOfAction: string; changes: string};
/** A rig actor: its keys live in a key sheet (v3/keys/<shot>.json, the joints); this lists what each key IS so the two can be compared. */
export type RigActor = {kind: 'rig'; keySheet: string; keys: ChartKey[]; breakdowns: Breakdown[]; note?: string};
export type ScalarKey = {frame: number; value: number; hold?: number; ease?: 'linear' | 'in' | 'out' | 'smooth'; why?: string};
/** A scalar track: one number per frame (`param`: what it drives), stepped on twos unless `quantise` says ones. */
export type PathPoint = {x: number; y: number; scale: number};
/** `path`: when the value is a position along waypoints (0 at the first, 1 at the second ...), the waypoints; `pathAt` reads a position and a scale off it. */
export type ScalarActor = {kind: 'scalar'; param: string; quantise?: 'ones' | 'twos'; keys: ScalarKey[]; note?: string; path?: PathPoint[]};
export type ChartActor = RigActor | ScalarActor;

/**
 * A piece the gadget projects: it leaves `from` at `start`, follows a cubic curve (`via` are its two control points) for `flight` frames and lands at
 * `to`. `kind` names the drawn prop; `size` is its landing scale. Starts of consecutive pieces are 3-5 frames apart (D51).
 */
export type ChartPiece = {id: string; kind: string; start: number; flight: number; /** `'funnel'`: the gadget's mouth on the launch frame, which the caller resolves. */ from: [number, number] | 'funnel'; via: [[number, number], [number, number]]; to: [number, number]; size: number; rot?: number; layer?: 'back' | 'front'; note?: string};

export type ChartPulse = {frame: number; what: string; length?: number};

export type Chart = {
  shot: string;
  fps: number;
  /** First and last frame (exclusive) of the shot on the film's timeline. */
  frames: [number, number];
  provisional?: boolean;
  actors: Record<string, ChartActor>;
  pieces: ChartPiece[];
  /** Seam pulses and the pop: frames where a cause happens, so the light layer's lag can be read against them. */
  pulses: ChartPulse[];
  /** Frames the light layer follows the drawn layer by (law 4: 2-4). */
  lag: {frames: number; recovery: number; note?: string};
  boil: {variants: number; rate: number; seed: number};
  camera: {span: [number, number]; note: string};
};

export const STAGGER_BAND: [number, number] = [3, 5];

/** A chart read from JSON, or an error naming the first thing wrong. */
export const parseChart = (json: unknown): Chart => {
  const c = json as Chart;
  if (typeof c?.shot !== 'string') throw new Error('chart: shot must be a string');
  if (!Array.isArray(c.frames) || c.frames.length !== 2 || !(c.frames[1] > c.frames[0])) throw new Error('chart: frames must be [first, last exclusive]');
  for (const [name, actor] of Object.entries(c.actors ?? {})) {
    if (actor.kind === 'rig') {
      const frames = actor.keys.map((k) => k.frame);
      if (frames.some((f, i) => i && f <= frames[i - 1]!)) throw new Error(`chart: actor "${name}" keys must be in increasing frame order`);
      for (const b of actor.breakdowns) if (!(b.favour > 0 && b.favour < 1) || b.favour === 0.5) throw new Error(`chart: actor "${name}" breakdown on ${b.frame} favours ${b.favour}; it must be between 0 and 1 and never one half`);
    } else if (actor.kind === 'scalar') {
      if (!actor.keys.length) throw new Error(`chart: scalar actor "${name}" has no keys`);
      const frames = actor.keys.map((k) => k.frame);
      if (frames.some((f, i) => i && f <= frames[i - 1]!)) throw new Error(`chart: actor "${name}" keys must be in increasing frame order`);
    } else throw new Error(`chart: actor "${name}" has an unknown kind`);
  }
  c.pieces.forEach((p, i) => {
    const prev = c.pieces[i - 1];
    if (prev && !(p.start - prev.start >= STAGGER_BAND[0] && p.start - prev.start <= STAGGER_BAND[1])) {
      throw new Error(`chart: piece "${p.id}" starts ${p.start - prev.start} frames after "${prev.id}"; related elements stagger by ${STAGGER_BAND[0]}-${STAGGER_BAND[1]} frames`);
    }
  });
  if (!(c.lag.frames >= 2 && c.lag.frames <= 4)) throw new Error(`chart: the light lag is ${c.lag.frames} frames; law 4 says 2-4`);
  return c;
};

const lerpNumber = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The track of a scalar actor. */
export const scalarTrack = (actor: ScalarActor): Track<number> => ({keys: actor.keys.map((k) => ({frame: k.frame, value: k.value, hold: k.hold, ease: k.ease as Ease | undefined}))});

/** A scalar actor's value on `frame`: its keys blended by their eases, the frame floored to twos unless the actor says ones. */
export const scalarAt = (actor: ScalarActor, frame: number): number => sample(scalarTrack(actor), frame, {quantise: actor.quantise ?? 'twos', lerp: lerpNumber});

/** A scalar actor's waypoint position and scale at path position `v` (clamped to the path, blended linearly between neighbours). */
export const pathAt = (actor: ScalarActor, v: number): PathPoint => {
  const pts = actor.path;
  if (!pts?.length) throw new Error(`chart: actor "${actor.param}" has no path`);
  const c = Math.max(0, Math.min(pts.length - 1, v)), i = Math.min(pts.length - 2, Math.floor(c)), t = pts.length === 1 ? 0 : c - i;
  const a = pts[i]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
  return {x: lerpNumber(a.x, b.x, t), y: lerpNumber(a.y, b.y, t), scale: lerpNumber(a.scale, b.scale, t)};
};

/**
 * Where a piece is on `frame`: not yet launched (`null`), in flight (position along its curve, size 0-1 of landing size), or landed (at `to`, scale 1).
 * The position steps on twos. `funnel` is where a piece with `from: 'funnel'` leaves from (the caller reads it off the gadget on the launch frame).
 */
export type PiecePose = {x: number; y: number; scale: number; rot: number; t: number; landed: boolean};
export const pieceAt = (p: ChartPiece, frame: number, funnel: [number, number]): PiecePose | null => {
  const f = Math.floor(frame / 2) * 2;
  if (f < p.start) return null;
  const t = Math.min(1, (f - p.start) / p.flight);
  const e = applyEase('smooth', t);
  const [p0, [p1, p2], p3] = [p.from === 'funnel' ? funnel : p.from, p.via, p.to];
  const u = 1 - e;
  const x = u * u * u * p0[0] + 3 * u * u * e * p1[0] + 3 * u * e * e * p2[0] + e * e * e * p3[0];
  const y = u * u * u * p0[1] + 3 * u * u * e * p1[1] + 3 * u * e * e * p2[1] + e * e * e * p3[1];
  // the piece grows out of the gadget's mouth (a small thing that gets bigger as it is thrown), overshoots a little and settles
  const grow = t < 1 ? 0.15 + 0.85 * applyEase('out', Math.min(1, t * 1.25)) : 1;
  const over = t >= 0.82 && t < 1 ? 1 + 0.07 * Math.sin(((t - 0.82) / 0.18) * Math.PI) : 1;
  return {x, y, scale: p.size * grow * over, rot: (p.rot ?? 0) * e, t, landed: t >= 1};
};
