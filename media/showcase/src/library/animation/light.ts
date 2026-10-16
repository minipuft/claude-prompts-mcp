/**
 * The light track: the emitter's colour per frame, on ones. One hue per beat (the shot's hue pair), eased to the next beat's over the
 * frames before it starts, or over the first half of a crossing so the colour completes as the world changes and never detours.
 */
import type {TimelineBeat} from './timeline';
import {sample, type Track} from './track';

const hex = (c: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) throw new Error(`light: "${c}" is not a #rrggbb colour`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Linear blend of two #rrggbb colours (in sRGB, as the film's other colour blends are). */
export const lerpHex = (a: string, b: string, t: number): string => {
  const [x, y] = [hex(a), hex(b)];
  return '#' + [0, 1, 2].map((i) => Math.round(x[i]! + (y[i]! - x[i]!) * t).toString(16).padStart(2, '0')).join('');
};

export type LightOptions = {
  /** Frames before the next beat's start over which the colour eases when there is no crossing. Default 30. */
  ease?: number;
};

/** One key per beat, at its start, holding that beat's colour until the ease into the next begins. */
export const lightTrack = (beats: TimelineBeat[], colourOf: (beat: TimelineBeat) => string, options: LightOptions = {}): Track<string> => ({
  keys: beats.map((beat) => {
    const easeFrom = beat.crossingOut ? beat.crossingOut[0] : beat.end - (options.ease ?? 30);
    return {frame: beat.start, value: colourOf(beat), hold: Math.max(0, easeFrom - beat.start), ease: 'smooth' as const};
  }),
});

export const lightAt = (track: Track<string>, frame: number): string => sample(track, frame, {quantise: 'ones', lerp: lerpHex});

/* ---------- the light contract (v3/light.json) ---------- */

export type LightPair = {radiance: string; accent: string};
/** `start` and `end` are fractions of the frame (the probes read values up to 2 as fractions); `on` and `off` are absolute frames, `off` exclusive. */
export type LightEmitter = {anchor: string; start: [number, number]; end: [number, number]; intensity: number; colour: string; on: number; off: number};
/** `radiance` and `grain` are the ledger's own words for the beat. A beat with no light carries no `emitter`. */
export type LightBeat = {pair: LightPair; emitter?: LightEmitter; radiance: string; grain: string};
/** `frames` is the crossing window [start, end); `path` is the emitter colour across it, first stop at the start, last at the end. */
export type LightCrossing = {from: string; to: string; frames: [number, number]; path: string[]};
export type LightContract = {beats: Record<string, LightBeat>; crossings: LightCrossing[]};

const isHex = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

/** A light contract read from JSON, or an error naming the first field that is wrong. */
export const parseLightContract = (json: unknown): LightContract => {
  const c = json as LightContract;
  if (typeof c?.beats !== 'object' || c.beats === null || Array.isArray(c.beats)) throw new Error('light: beats must be an object keyed by beat id');
  for (const [id, b] of Object.entries(c.beats)) {
    if (!isHex(b?.pair?.radiance) || !isHex(b.pair.accent)) throw new Error(`light: beat "${id}" needs a pair of #rrggbb colours`);
    const e = b.emitter;
    if (e === undefined) continue;
    if (!isHex(e.colour)) throw new Error(`light: beat "${id}" emitter.colour must be #rrggbb`);
    for (const k of ['on', 'off', 'intensity'] as const) if (typeof e[k] !== 'number') throw new Error(`light: beat "${id}" emitter.${k} must be a number`);
    for (const k of ['start', 'end'] as const) if (!Array.isArray(e[k]) || e[k].length !== 2) throw new Error(`light: beat "${id}" emitter.${k} must be [x, y]`);
  }
  if (!Array.isArray(c.crossings)) throw new Error('light: crossings must be a list');
  for (const x of c.crossings) if (!Array.isArray(x.path) || x.path.length < 2 || !x.path.every(isHex)) throw new Error(`light: crossing ${x.from} -> ${x.to} needs a path of at least two #rrggbb colours`);
  for (const x of c.crossings) {
    const dips = pathDips(x.path);
    if (dips.length) throw new Error(`light: crossing ${x.from} -> ${x.to} dips on the way (sample ${dips[0]![0]}: ${dips[0]![1]}); a crossing path holds value and chroma`);
  }
  return c;
};

/** True when the contract carries every beat of the timeline and every one of its crossings; a partial file is not used (fallback: the shot-hue derivation). */
export const coversTimeline = (contract: LightContract, beats: {id: string}[], crossings: {from: string; to: string}[]): boolean =>
  beats.every((b) => contract.beats[b.id]) && crossings.every((x) => contract.crossings.some((c) => c.from === x.from && c.to === x.to));

/** The emitter's colour in a beat: its own, else the pair's radiance (a beat with no light still has a colour for the crossings around it). */
const beatColour = (contract: LightContract, id: string): string => contract.beats[id]!.emitter?.colour ?? contract.beats[id]!.pair.radiance;

/**
 * The colour track of a contract: each beat holds its colour, a crossing walks its `path` across the window, and beats with no crossing between
 * them ease over the last `ease` frames (default 30) as `lightTrack` does.
 */
export const lightTrackFromContract = (beats: TimelineBeat[], contract: LightContract, options: LightOptions = {}): Track<string> => {
  const ease = options.ease ?? 30;
  const keys: Track<string>['keys'] = [];
  beats.forEach((beat, i) => {
    const entry = beat.crossingIn ? contract.crossings.find((c) => c.frames[0] === beat.crossingIn![0] && c.frames[1] === beat.crossingIn![1]) : undefined;
    if (beat.crossingIn && !entry) throw new Error(`light: no contract crossing for the window ${beat.crossingIn.join('-')} into "${beat.id}"`);
    if (entry) {
      const [a, b] = entry.frames;
      entry.path.forEach((value, k) => keys.push({frame: Math.round(a + ((b - a) * k) / (entry.path.length - 1)), value, ease: 'linear'}));
    } else keys.push({frame: beat.start, value: beatColour(contract, beat.id), ease: 'smooth'});
    const last = keys[keys.length - 1]!;
    const holdEnd = beat.crossingOut ? beat.crossingOut[0] : i === beats.length - 1 ? beat.end : beat.end - ease;
    last.hold = Math.max(0, holdEnd - last.frame);
  });
  return {keys};
};

/** The emitter's intensity on `frame`: its own inside [on, off), 0 outside it and in a beat with no emitter. */
export const emitterIntensityAt = (contract: LightContract, beatId: string, frame: number): number => {
  const e = contract.beats[beatId]?.emitter;
  return e && frame >= e.on && frame < e.off ? e.intensity : 0;
};

/* ---- compiling a contract ---- */

const toHsl = (c: string): [number, number, number] => {
  const [r, g, b] = hex(c).map((v) => v / 255) as [number, number, number];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
};
/** A #rrggbb colour from hue in degrees, saturation and lightness (both 0..1). */
export const fromHsl = (h: number, s: number, l: number): string => {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
};
export const hueOfHex = (c: string): number => toHsl(c)[0];
/** Smallest angle between two hues, in degrees. */
export const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

/**
 * How far a crossing path's value (the largest channel, 0..1) may sit below the lower of its two endpoints' before the path is called a dip: one twentieth of the range. It is a bound on the
 * path, not a measurement fitted to a frame: a straight blend of two colours is never below its lower endpoint in value, so a path that is has been pulled through something darker (a
 * grey, a tan) on the way. Chroma (largest channel minus smallest, 0..1) gets one 8-bit level, the rounding of a #rrggbb sample, and no more: it may not fall below the lower endpoint's.
 */
export const PATH_VALUE_MARGIN = 0.05;

const valueOf = (c: string): number => Math.max(...hex(c)) / 255;
const chromaOf = (c: string): number => (Math.max(...hex(c)) - Math.min(...hex(c))) / 255;

/** The samples of a path that dip: `[index, what]` for each interior sample whose value is more than `PATH_VALUE_MARGIN` under the lower endpoint's, or whose chroma is under the lower endpoint's. Empty for a held path. */
export const pathDips = (path: string[]): [number, string][] => {
  if (path.length < 3) return [];
  const first = path[0]!, last = path[path.length - 1]!;
  const valueFloor = Math.min(valueOf(first), valueOf(last)) - PATH_VALUE_MARGIN, chromaFloor = Math.min(chromaOf(first), chromaOf(last)) - 1 / 255;
  const dips: [number, string][] = [];
  path.forEach((c, i) => {
    if (i === 0 || i === path.length - 1) return;
    if (valueOf(c) < valueFloor) dips.push([i, `value ${valueOf(c).toFixed(2)} under the floor ${valueFloor.toFixed(2)}`]);
    else if (chromaOf(c) < chromaFloor) dips.push([i, `chroma ${chromaOf(c).toFixed(2)} under the lower endpoint's ${(chromaFloor).toFixed(2)}`]);
  });
  return dips;
};

/** `n` colours from `a` to `b` with the hue walking the shortest arc (never through a third hue the other way round) and saturation and lightness blended straight, so the path never greys. */
export const hslPath = (a: string, b: string, n = 5): string[] => {
  if (a.toLowerCase() === b.toLowerCase()) return [a, b];
  const [h0, s0, l0] = toHsl(a), [h1, s1, l1] = toHsl(b);
  const raw = (((h1 - h0) % 360) + 540) % 360 - 180;
  const arc = raw === -180 ? 180 : raw;
  const valueFloor = Math.min(valueOf(a), valueOf(b)) - PATH_VALUE_MARGIN * 0.5, chromaFloor = Math.min(chromaOf(a), chromaOf(b));
  return Array.from({length: n}, (_, i) => {
    const t = i / (n - 1);
    if (i === 0) return a;
    if (i === n - 1) return b;
    const h = (h0 + arc * t + 360) % 360;
    let s = s0 + (s1 - s0) * t, l = l0 + (l1 - l0) * t;
    // held: raise the blended sample to the path's floors (saturation first, at the blended lightness, then lightness) so the path is never muddier or darker than its endpoints allow
    for (let k = 0; k < 100 && (valueOf(fromHsl(h, s, l)) < valueFloor || chromaOf(fromHsl(h, s, l)) < chromaFloor); k++) {
      if (s < 1) s = Math.min(1, s + 0.01);
      else l = Math.min(1, l + 0.01);
    }
    return fromHsl(h, s, l);
  });
};

/** Rec. 709 luma of a #rrggbb on 0-255 in sRGB, the ranking `probe-eyetrace.py` ranks pixels by (C29). */
export const lumaOf = (c: string): number => {
  const [r, g, b] = hex(c);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** `c` lightened at its own hue and HSL saturation to the least lightness whose luma reaches `target` (white if none does). The hue is the pair's, so C24 still holds; only the lightness moves. */
export const liftToLuma = (c: string, target: number): string => {
  if (lumaOf(c) >= target) return c;
  const [h, sat, l] = toHsl(c);
  if (lumaOf(fromHsl(h, sat, 1)) < target) return '#ffffff';
  let lo = l, hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (lumaOf(fromHsl(h, sat, mid)) >= target) hi = mid;
    else lo = mid;
  }
  return fromHsl(h, sat, hi);
};

export type LightInputs = {
  beats: TimelineBeat[];
  crossings: {from: string; to: string; start: number; end: number}[];
  /** The hue pair of a beat (the shot's D74 pair). */
  pairOf: (beatId: string) => LightPair;
  /** A world's radiance as its contract declares it. */
  worldRadiance: (worldId: string) => {on: boolean; colour?: string};
  /** The beat's emitter path in screen pixels and what it sits on; absent when the blocking has none. */
  emitterOf: (beatId: string) => {start: [number, number]; end: [number, number]; anchor: string} | undefined;
  size: {width: number; height: number};
  /** Hue tolerance for "the world's own radiance colour stands in for the accent". Default 15, the probes' C24 tolerance. */
  hueTolerance?: number;
  /** Frames between one beat's emitter going off and the next one's coming on (C18: 2-4). Default 2. */
  handoff?: number;
  /**
   * The least luma (0-255) an emitter's core draws at: its colour times its intensity. The light is the subject (C6, D44) and the eye trace (C29) finds the brightest region outside the
   * fixed role fills, so a Turrell blue (luma 78) or a steel (33) that the garment, the frame's contour or a crayon speck outshines is not read as the light. A colour below
   * `floor / intensity` is lifted at its own hue (`liftToLuma`); an intensity too low for even white to reach the floor is raised to the least that can (never above 1). Default 0: no floor.
   */
  luminanceFloor?: number;
};

const round4 = (v: number): number => Math.round(v * 10000) / 10000;

/**
 * The light contract from its sources. A beat has an emitter unless the ledger's emitter line says `none` or its world draws no radiance. The
 * emitter colour is the pair's radiance, except where the ledger's radiance line names the accent: then the world's own radiance colour if it
 * sits within tolerance of the accent's hue, else the accent. A crossing's path walks the shortest hue arc from the from-beat's colour to the
 * to-beat's. Emitters come on at their beat's start and go off `handoff` frames before the next emitter's beat starts.
 */
export const compileLight = (input: LightInputs): LightContract => {
  const {beats, size} = input;
  const tol = input.hueTolerance ?? 15, handoff = input.handoff ?? 2;
  const hasEmitter = (b: TimelineBeat): boolean => !/^none\b/i.test(b.effects.emitter ?? 'none') && input.worldRadiance(b.world).on && input.emitterOf(b.id) !== undefined;
  const out: LightContract = {beats: {}, crossings: []};
  beats.forEach((b, i) => {
    const pair = input.pairOf(b.id);
    const entry: LightBeat = {pair, radiance: b.effects.radiance ?? '', grain: b.effects.grain ?? ''};
    if (hasEmitter(b)) {
      const path = input.emitterOf(b.id)!;
      const world = input.worldRadiance(b.world);
      const namesAccent = /accent/i.test(b.effects.radiance ?? '');
      const stand = world.colour && hueDistance(hueOfHex(world.colour), hueOfHex(pair.accent)) <= tol ? world.colour : pair.accent;
      const next = beats[i + 1];
      const floor = input.luminanceFloor ?? 0;
      const intensity = Math.max(/\btiny\b/i.test(b.effects.emitter ?? '') ? 0.5 : 0.9, floor > 0 ? Math.min(1, (floor / 255) * 1.05) : 0);
      const colour = floor > 0 ? liftToLuma(namesAccent ? stand : pair.radiance, floor / intensity) : namesAccent ? stand : pair.radiance;
      entry.emitter = {
        anchor: path.anchor,
        start: [round4(path.start[0] / size.width), round4(path.start[1] / size.height)],
        end: [round4(path.end[0] / size.width), round4(path.end[1] / size.height)],
        intensity: Math.round(intensity * 1000) / 1000,
        colour,
        on: b.start,
        off: next && hasEmitter(next) ? b.end - handoff : b.end,
      };
    }
    out.beats[b.id] = entry;
  });
  // a beat with no emitter still has a colour for the crossings around it: its pair's radiance, lifted to the floor like the lit beats' so a crossing never walks from a lifted colour to an unlifted one
  const colourOf = (id: string): string => out.beats[id]!.emitter?.colour ?? ((input.luminanceFloor ?? 0) > 0 ? liftToLuma(out.beats[id]!.pair.radiance, input.luminanceFloor! / 0.9) : out.beats[id]!.pair.radiance);
  for (const x of input.crossings) out.crossings.push({from: x.from, to: x.to, frames: [x.start, x.end], path: hslPath(colourOf(x.from), colourOf(x.to))});
  return out;
};
