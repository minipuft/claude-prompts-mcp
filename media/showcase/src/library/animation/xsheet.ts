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
  /** What the finished pass draws on this frame: a key, a hold, or a breakdown favouring `favour` of the way to `to`. */
  chart: {phase: 'key' | 'hold' | 'breakdown'; favour: number | null; to: string | null};
  camera: CameraPose;
  /** The live emitter in stage pixels and its colour; null on a frame with no light (a beat without an emitter, or the frames of a handoff). */
  emitter: {x: number; y: number; hex: string} | null;
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
  emitter: {x: number; y: number; hex: string} | null;
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
      camera: {x: r1(s.camera.x), y: r1(s.camera.y), zoom: r3(s.camera.zoom), rot: r1(s.camera.rotation)},
      emitter: s.emitter ? {x: r1(s.emitter.x), y: r1(s.emitter.y), hex: s.emitter.hex} : null,
      phase: phaseOf(s),
    };
  });
