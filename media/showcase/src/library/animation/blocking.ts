/**
 * Blocking: where the actors and props stand in the frame, per beat. A `Blocking` is plain numbers in screen pixels at the film's frame size
 * (1280x720 for the showcase); worlds read one passed in through their scene props instead of a module constant, so the same renderer can
 * draw the same scene at different places for different beats.
 *
 * v3/blocking/test-scene.json is the one every world was proved on (D78); v3/blocking/<beat-id>.json is a beat's own, `provisional` until its
 * layout sheet is approved. Between beats the placement eases on twos (`blockingTrack`).
 */
import {sample, type Track} from './track';

export type Box = {x: number; y: number; width: number; height: number};
/** Where an actor that has no dedicated field (box, gadget, structure, bubble, stalk) stands: an anchor point in screen pixels and a scale. */
export type ActorPlacement = {x: number; y: number; scale: number; facing?: 'left' | 'right'};
/** The beat's light: where the emitter starts and ends across the beat (screen pixels) and the thing it sits on. Colour and timing belong to the light contract. */
export type EmitterPath = {start: [number, number]; end: [number, number]; anchor: string};
export type Blocking = {
  id: string;
  /** Beat the file belongs to, when it is a beat's blocking (not the test scene). */
  beat?: string;
  provisional?: boolean;
  /** Which fields came from which contract, or why it is a copy of the test scene. */
  derivedFrom?: string;
  /** The shot (v3/shots.json) this beat belongs to, when one exists. */
  shot?: string | null;
  /** The key sheet (v3/keys/<name>.json) the beat's figure plays, when it is not the shot's: a beat that has its own pose sheet inside a shot that has none (beat 4 inside the s02 layout shot). The camera still follows `shot`. */
  poseShot?: string;
  /** Props and boxes that touch on purpose (`probe-blocking.py`, props apart): each names two things on the stage and why they overlap. An overlap nobody declared is refused. */
  contacts?: {a: string; b: string; why: string}[];
  /** The human: HumanPuppet canvas scale and the canvas's top-left. */
  figure: {scale: number; x: number; y: number};
  codex: {x: number; y: number; scale: number};
  clawd: {x: number; y: number; scale: number};
  frame: Box;
  /** Kit blocks that touch at `join.x`. `role` names a palette role of the kit. */
  blocks: (Box & {role: 'main1' | 'main2'})[];
  join: {x: number; y: number};
  arch: {x: number; y: number; width: number; height: number; opening: number; top: number};
  gates: {x: number; y: number; r: number}[];
  floor: {y: number};
  /** Crop that holds the human and nothing else, with room for a leading-line shift (measurements read it). */
  figureCrop: Box;
  /** Every other actor the ledger names in this beat, by name. The top-level `figure`, `codex`, `clawd` and `frame` stay where the renderers read them. */
  actors?: Record<string, ActorPlacement>;
  /** The emitter's path across the beat. Absent in the test scene; present in every beat file. */
  emitter?: EmitterPath;
  /** The composition card (an id on v3/references/board.json) the staging borrows its framing from. */
  card?: string;
  /** Why that card, and that it is provisional. */
  cardNote?: string;
};

const num = (v: unknown, path: string): void => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`blocking: ${path} must be a finite number, got ${JSON.stringify(v)}`);
};
const group = (v: unknown, path: string, keys: string[]): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null) throw new Error(`blocking: ${path} is missing`);
  for (const k of keys) num((v as Record<string, unknown>)[k], `${path}.${k}`);
  return v as Record<string, unknown>;
};

/** A blocking file read as a `Blocking`, or an error naming the first field that is missing or not a number. A silent default would hide a wrong file. */
export const parseBlocking = (json: unknown): Blocking => {
  const b = json as Record<string, unknown>;
  if (typeof b?.id !== 'string') throw new Error('blocking: id must be a string');
  group(b.figure, 'figure', ['scale', 'x', 'y']);
  group(b.codex, 'codex', ['x', 'y', 'scale']);
  group(b.clawd, 'clawd', ['x', 'y', 'scale']);
  group(b.frame, 'frame', ['x', 'y', 'width', 'height']);
  group(b.join, 'join', ['x', 'y']);
  group(b.arch, 'arch', ['x', 'y', 'width', 'height', 'opening', 'top']);
  group(b.floor, 'floor', ['y']);
  group(b.figureCrop, 'figureCrop', ['x', 'y', 'width', 'height']);
  if (!Array.isArray(b.blocks) || !b.blocks.length) throw new Error('blocking: blocks must be a non-empty list');
  b.blocks.forEach((k, i) => group(k, `blocks[${i}]`, ['x', 'y', 'width', 'height']));
  if (!Array.isArray(b.gates) || !b.gates.length) throw new Error('blocking: gates must be a non-empty list');
  b.gates.forEach((g, i) => group(g, `gates[${i}]`, ['x', 'y', 'r']));
  if (b.actors !== undefined) {
    if (typeof b.actors !== 'object' || b.actors === null || Array.isArray(b.actors)) throw new Error('blocking: actors must be an object keyed by actor name');
    for (const [name, a] of Object.entries(b.actors)) {
      const placed = group(a, `actors.${name}`, ['x', 'y', 'scale']);
      if (placed.facing !== undefined && placed.facing !== 'left' && placed.facing !== 'right') throw new Error(`blocking: actors.${name}.facing must be "left" or "right", got ${JSON.stringify(placed.facing)}`);
    }
  }
  if (b.emitter !== undefined) {
    const e = b.emitter as Record<string, unknown> | null;
    if (typeof e !== 'object' || e === null) throw new Error('blocking: emitter must be an object');
    for (const end of ['start', 'end'] as const) {
      const pt = e[end];
      if (!Array.isArray(pt) || pt.length !== 2) throw new Error(`blocking: emitter.${end} must be [x, y]`);
      num(pt[0], `emitter.${end}[0]`);
      num(pt[1], `emitter.${end}[1]`);
    }
    if (typeof e.anchor !== 'string' || !e.anchor) throw new Error('blocking: emitter.anchor must name what the light sits on');
  }
  if (b.card !== undefined && (typeof b.card !== 'string' || !b.card)) throw new Error('blocking: card must be a board card id');
  return json as Blocking;
};

/** Blend two same-shaped values: numbers lerp, arrays and objects recurse, everything else (ids, notes, roles) comes from `a`. */
export const lerpDeep = <T>(a: T, b: T, t: number): T => {
  if (typeof a === 'number' && typeof b === 'number') return (a + (b - a) * t) as T;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((v, i) => lerpDeep(v, b[i], t)) as T;
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(a)) out[k] = k in b ? lerpDeep((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], t) : (a as Record<string, unknown>)[k];
    return out as T;
  }
  return a;
};

export const lerpBlocking = (a: Blocking, b: Blocking, t: number): Blocking => lerpDeep(a, b, t);

/**
 * A blocking per beat as a track: each beat holds its own placement until `ease` frames before the next beat starts, then eases to the next
 * on twos (a drawn layer: the placement steps, it does not glide).
 */
export const blockingTrack = (beats: {id: string; start: number; end: number}[], byBeat: Record<string, Blocking>, ease = 24): Track<Blocking> => ({
  keys: beats.map((beat) => {
    const value = byBeat[beat.id];
    if (!value) throw new Error(`blocking: no blocking for beat "${beat.id}"`);
    return {frame: beat.start, value, hold: Math.max(0, beat.end - beat.start - ease), ease: 'smooth' as const};
  }),
});

export const blockingAt = (track: Track<Blocking>, frame: number): Blocking => sample(track, frame, {quantise: 'twos', lerp: lerpBlocking});

/** The emitter's position on `frame` of a beat: a straight line from `start` to `end` across the beat, on ones (light is not a drawn layer). Null when the beat has none. */
export const emitterPointAt = (blocking: Blocking, beat: {start: number; end: number}, frame: number): {x: number; y: number} | null => {
  const e = blocking.emitter;
  if (!e) return null;
  const t = beat.end - beat.start <= 1 ? 0 : Math.max(0, Math.min(1, (frame - beat.start) / (beat.end - beat.start - 1)));
  return {x: e.start[0] + (e.end[0] - e.start[0]) * t, y: e.start[1] + (e.end[1] - e.start[1]) * t};
};
