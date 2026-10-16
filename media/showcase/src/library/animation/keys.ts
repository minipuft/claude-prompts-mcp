/**
 * Key sheets: the named poses of one actor in one shot, with their holds and breakdowns, as data (v3/keys/<shot>.json). `toChart` turns a
 * sheet into the chart `poseAt` plays; `describeFrame` says what a frame of that chart IS (a key, a hold, a breakdown) for the exposure sheet.
 */
import type {Joints, PoseChart} from '../motion';
import {marksIn, quantise, segmentAt, sortedKeys, type Breakdown, type Key} from './track';

export type NamedKey = {name: string; frame: number; /** frames the pose is kept before the move to the next key may begin */ hold?: number; joints: Joints};
export type KeySheet = {
  shot: string;
  actor: string;
  provisional?: boolean;
  note?: string;
  keys: NamedKey[];
  breakdowns?: Breakdown<Joints>[];
};

/** A key sheet read from JSON, or an error naming what is wrong: names and frames unique, joints the same set in every key, favours strictly between 0 and 1 and never 1/2. */
export const parseKeySheet = (json: unknown): KeySheet => {
  const s = json as KeySheet;
  if (typeof s?.shot !== 'string' || typeof s.actor !== 'string') throw new Error('keys: shot and actor must be strings');
  if (!Array.isArray(s.keys) || !s.keys.length) throw new Error(`keys: ${s.shot} has no keys`);
  const names = new Set<string>(), frames = new Set<number>();
  const jointSet = Object.keys(s.keys[0]!.joints ?? {}).sort().join(',');
  for (const k of s.keys) {
    if (typeof k.name !== 'string' || !Number.isInteger(k.frame)) throw new Error(`keys: every key needs a name and an integer frame (${JSON.stringify(k.name)})`);
    if (names.has(k.name)) throw new Error(`keys: key name "${k.name}" is used twice`);
    if (frames.has(k.frame)) throw new Error(`keys: two keys on frame ${k.frame}`);
    if (Object.keys(k.joints ?? {}).sort().join(',') !== jointSet) throw new Error(`keys: key "${k.name}" names different joints from the first key`);
    names.add(k.name);
    frames.add(k.frame);
  }
  for (const b of s.breakdowns ?? []) {
    if (!(b.favour > 0 && b.favour < 1) || b.favour === 0.5) throw new Error(`keys: breakdown on frame ${b.frame} favours ${b.favour}; it must be between 0 and 1 and never one half`);
  }
  return s;
};

export const toChart = (sheet: KeySheet): PoseChart => ({keys: sheet.keys.map((k) => ({frame: k.frame, joints: k.joints, hold: k.hold})), breakdowns: sheet.breakdowns});

export type FrameInfo = {
  /** `key`: the pose is a key's, on its frame. `hold`: still the previous key's pose. `breakdown`: between two keys, `favour` of the way. */
  phase: 'key' | 'hold' | 'breakdown';
  /** The key the pose comes from. */
  from: string;
  /** The key it moves toward, while one follows. */
  to: string | null;
  favour: number | null;
};

/** What the drawn layer shows at `frame` (on twos, as `poseAt` does). */
export const describeFrame = (sheet: KeySheet, frame: number): FrameInfo => {
  const named = new Map(sheet.keys.map((k) => [k.frame, k.name]));
  const keys: Key<null>[] = sortedKeys({keys: sheet.keys.map((k) => ({frame: k.frame, value: null, hold: k.hold}))});
  const f = quantise(frame, 2);
  const {index, from, to, start} = segmentAt(keys, f);
  const fromName = named.get(from.frame)!;
  if (index < 0 || !to) return {phase: f === from.frame ? 'key' : 'hold', from: fromName, to: null, favour: null};
  const active = marksIn(from, to, start, sheet.breakdowns ?? [])
    .filter((m) => m.frame <= f)
    .sort((p, q) => q.frame - p.frame)[0];
  const toName = named.get(to.frame)!;
  if (active) return {phase: 'breakdown', from: fromName, to: toName, favour: active.favour};
  return {phase: f === from.frame ? 'key' : 'hold', from: fromName, to: toName, favour: null};
};

/** Every breakdown the chart plays, authored or automatic (thirds), as "between these keys, on this frame, favouring this much". */
export const listBreakdowns = (sheet: KeySheet): {between: [string, string]; frame: number; favour: number; authored: boolean}[] => {
  const keys = [...sheet.keys].sort((p, q) => p.frame - q.frame);
  const out: {between: [string, string]; frame: number; favour: number; authored: boolean}[] = [];
  keys.slice(0, -1).forEach((from, i) => {
    const to = keys[i + 1]!;
    const asKey = (k: NamedKey): Key<null> => ({frame: k.frame, value: null, hold: k.hold});
    const own = (sheet.breakdowns ?? []).filter((b) => b.frame > from.frame && b.frame < to.frame);
    for (const m of marksIn(asKey(from), asKey(to), from.frame + (from.hold ?? 0), sheet.breakdowns ?? [])) out.push({between: [from.name, to.name], frame: m.frame, favour: m.favour, authored: own.length > 0});
  });
  return out;
};

/**
 * What a holds-only animatic draws on `frame` (shot-local, on twos): each key is on screen for exactly the hold it declares, then the next key is drawn from that frame on (the move
 * between two keys is not drawn: no inbetweens). A key that declares no hold stays until the next key's own frame. So `rest` with `hold: 24` is 24 frames, not the 36 until the
 * key after it, and the exposure sheet and the hold-band probe read the same duration. The pop frames are even (twos); a declared hold is never longer than the gap to the next key.
 */
export const heldDrawing = (sheet: KeySheet, frame: number): {key: NamedKey; next: NamedKey | null; start: number; info: FrameInfo} => {
  const keys = [...sheet.keys].sort((p, q) => p.frame - q.frame);
  const shownFrom: number[] = [];
  keys.forEach((k, i) => {
    if (i === 0) return void shownFrom.push(k.frame);
    const prev = keys[i - 1]!;
    shownFrom.push(prev.hold === undefined ? k.frame : Math.min(k.frame, quantise(shownFrom[i - 1]! + prev.hold, 2)));
  });
  const f = quantise(frame, 2);
  let index = 0;
  shownFrom.forEach((from, i) => {
    if (from <= f) index = i;
  });
  const key = keys[index]!, next = keys[index + 1] ?? null, start = shownFrom[index]!;
  return {key, next, start, info: {phase: f === start ? 'key' : 'hold', from: key.name, to: next?.name ?? null, favour: null}};
};
