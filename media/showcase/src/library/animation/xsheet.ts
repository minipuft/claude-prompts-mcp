/**
 * The exposure sheet: one row per frame, the per-frame projection of the timeline's tracks. Pure formatting of a state the caller computes;
 * scripts/animation/xsheet.mjs writes the HTML and src/scenes/XSheet.tsx draws a page of it.
 */
import type {CameraPose} from './camera';

export type XState = {
  frame: number;
  beat: string;
  /** `home`, or `home>crayon` inside a crossing. */
  world: string;
  /** Inside a crossing: which third (`reduce`, `line`, `refill`) and how far through the window. Otherwise null. */
  crossing: {phase: 'reduce' | 'line' | 'refill'; t: number} | null;
  /** The key held on this frame by the animatic (holds only). */
  drawing: string;
  /** What the animatic draws on this frame: a key (the frame it comes on), or a hold of it. A holds-only animatic draws no breakdown; `favour` is set only for a finished pass that does. */
  chart: {phase: 'key' | 'hold' | 'breakdown'; favour: number | null; to: string | null};
  camera: CameraPose;
  /** The live emitter in stage pixels and its colour; null on a frame with no light (a beat without an emitter, or the frames of a handoff). `strength` (default 1) is the share of its intensity the picture draws: 1, except inside a crossing, where the world's light fades out while it reduces to line, is off in the line world and fades in as the next world refills. */
  emitter: {x: number; y: number; hex: string; strength?: number} | null;
  /** The key that STARTS on this frame (its name), else null. */
  key: string | null;
  /** The hold that key declares, in frames; null when it declares none. */
  hold: number | null;
};

export const XHEADER = ['frame', 'beat', 'world', 'drawing (held)', 'chart', 'breakdown favour', 'camera x', 'camera y', 'zoom', 'rotation', 'emitter', 'crossing phase'] as const;

export const xsheetRow = (s: XState): string[] => [
  String(s.frame),
  s.beat,
  s.world,
  s.drawing,
  s.chart.phase === 'breakdown' ? `breakdown to ${s.chart.to}` : s.chart.phase,
  s.chart.favour === null ? '' : s.chart.favour.toFixed(2),
  s.camera.x.toFixed(1),
  s.camera.y.toFixed(1),
  s.camera.zoom.toFixed(3),
  s.camera.rotation.toFixed(1),
  s.emitter?.hex ?? '',
  s.crossing ? `${s.crossing.phase} ${s.crossing.t.toFixed(2)}` : '',
];

/** Which third of a crossing window a frame is in (Crossing's reduce / line / refill) and how far through the window it is. */
export const crossingPhase = (frame: number, start: number, length: number): {phase: 'reduce' | 'line' | 'refill'; t: number} => {
  const t = (frame - start) / length;
  return {phase: t < 1 / 3 ? 'reduce' : t < 2 / 3 ? 'line' : 'refill', t};
};

const smooth = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};
/** Fills under 8 % or over 92 % are dropped to 0 or 1 (Crossing's `settle`). */
const settle = (r: number): number => (r < 0.08 ? 0 : r > 0.92 ? 1 : r);

/**
 * The share of its light the picture draws on a frame of a crossing, the opacity `Crossing` gives the world's radiance: `1 - reduce` while the from-world reduces to its contour, 0 in the
 * line world (radiance off), and the refill's own progress while the to-world fills back in. Everything steps on twos, so `frame` is quantised first. 1 outside a crossing.
 */
export const emitterStrength = (frame: number, window: {start: number; length: number} | null): number => {
  if (!window) return 1;
  const t = (Math.floor(frame / 2) * 2 - window.start) / window.length;
  if (t < 1 / 3) return t <= 0 ? 1 : 1 - settle(smooth(t * 3));
  if (t < 2 / 3) return 0;
  return settle(smooth((t - 2 / 3) * 3));
};

export const XPHASES = ['hold', 'move', 'line', 'reduce', 'refill'] as const;
export type XPhase = (typeof XPHASES)[number];

/** `reduce`, `line` and `refill` inside a crossing (its thirds); outside one, `move` while the finished pass is between keys on a breakdown, else `hold`. */
export const phaseOf = (s: XState): XPhase => (s.crossing ? s.crossing.phase : s.chart.phase === 'breakdown' ? 'move' : 'hold');

export type XSheetJsonRow = {
  frame: number;
  beat: string;
  world: string;
  key: string | null;
  hold: number | null;
  /** The favour (0-1, never one half) of a breakdown that starts on this frame, else null. */
  breakdown: number | null;
  camera: {x: number; y: number; zoom: number; rot: number};
  emitter: {x: number; y: number; hex: string; strength: number} | null;
  phase: XPhase;
};

const r1 = (v: number): number => Math.round(v * 10) / 10;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** The sheet as data (v3/xsheet.json, read by the probes): one row per state, in order. A breakdown is marked once, on the frame it starts. */
export const xsheetJsonRows = (states: XState[]): XSheetJsonRow[] =>
  states.map((s, i) => {
    const prev = states[i - 1];
    const starts = s.chart.phase === 'breakdown' && !(prev && prev.chart.phase === 'breakdown' && prev.chart.favour === s.chart.favour && prev.chart.to === s.chart.to);
    return {
      frame: s.frame,
      beat: s.beat,
      world: s.world,
      key: s.key,
      hold: s.hold,
      breakdown: starts ? s.chart.favour : null,
      // three decimals: a camera easing out of a move shifts the picture by a fraction of a pixel per frame, which a probe that inverts the camera must see as a move (row 4.5: at one decimal 808 and 809 read as the same camera)
      camera: {x: r3(s.camera.x), y: r3(s.camera.y), zoom: r3(s.camera.zoom), rot: r3(s.camera.rotation)},
      emitter: s.emitter ? {x: r1(s.emitter.x), y: r1(s.emitter.y), hex: s.emitter.hex, strength: r3(s.emitter.strength ?? 1)} : null,
      phase: phaseOf(s),
    };
  });
