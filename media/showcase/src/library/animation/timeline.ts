/**
 * The timeline: a beat ledger (seconds, worlds, transitions, tracked-state flips) compiled into frames. Pure; no rendering, no file access.
 * `scripts/animation/compile-timeline.mjs` writes the result to v3/timeline.json; compositions and the exposure sheet read that file.
 *
 * Frames are cumulative: a beat starts where the one before it ends, so lengthening one beat moves every later beat by the same number of frames.
 */

export type LedgerState = {key: string; from: unknown; to: unknown; scope: string};
export type LedgerBeat = {
  id: string;
  /** A world id, or a phrase that starts with one ("home → portal"). */
  world: string;
  seconds: number;
  camera?: string;
  effects?: Record<string, string>;
  actions?: {actor: string; does: string}[];
  transition_in?: string;
  transition_out?: string;
  state?: LedgerState[];
  /** Optional override of the crossing into the next beat: frames taken from the end of this beat and from the start of the next. */
  crossing_frames?: [number, number];
};
export type Ledger = {fps: number; durationInFrames?: number; beats: LedgerBeat[]};

/** When a state flip holds: forever, over a range of beats (1-based in the ledger's prose, ids here), or until a beat starts. */
export type StateScope =
  | {kind: 'permanent'; raw: string}
  | {kind: 'beats'; raw: string; fromBeat: string; toBeat: string}
  | {kind: 'until'; raw: string; beat: string}
  | {kind: 'unparsed'; raw: string};

export type StateFlip = {key: string; from: unknown; to: unknown; scope: StateScope; /** The frame the flip happens: the start of the beat that carries it. */ frame: number; /** First and last frame (exclusive) the flipped value holds, when the scope names them. */ holds: [number, number] | null};

/** Frames [start, end) of the picture crossing from one world to the next, spanning the cut between two beats. */
export type CrossingWindow = {from: string; to: string; fromWorld: string; toWorld: string; start: number; end: number; length: number; /** frames taken from the end of `from` and from the start of `to` */ split: [number, number]};

export type TimelineBeat = {
  id: string;
  index: number;
  start: number;
  end: number;
  frames: number;
  world: string;
  worldRaw: string;
  camera: string | null;
  effects: Record<string, string>;
  transitionIn: string | null;
  transitionOut: string | null;
  /** [start, end) of the crossing that enters / leaves this beat, null when the world does not change at that boundary. */
  crossingIn: [number, number] | null;
  crossingOut: [number, number] | null;
  flips: StateFlip[];
};

export type Timeline = {fps: number; durationInFrames: number; beats: TimelineBeat[]; crossings: CrossingWindow[]};

export type CompileOptions = {
  /** Longest a crossing window may be, in frames, counting both sides of the cut. Default 70 (Crossing's default length). */
  crossingCap?: number;
};

/** The world id a ledger `world` field names: its first word. */
export const worldIdOf = (raw: string): string => {
  const m = /^[A-Za-z][\w-]*/.exec(raw.trim());
  if (!m) throw new Error(`timeline: cannot read a world id from "${raw}"`);
  return m[0];
};

const parseScope = (raw: string, ids: string[]): StateScope => {
  const beatId = (n: string): string => {
    const id = ids[Number(n) - 1];
    if (!id) throw new Error(`timeline: scope "${raw}" names beat ${n}, but the ledger has ${ids.length}`);
    return id;
  };
  const lower = raw.toLowerCase();
  if (lower.startsWith('permanent')) return {kind: 'permanent', raw};
  const until = /^until beats? (\d+)/.exec(lower);
  if (until) return {kind: 'until', raw, beat: beatId(until[1]!)};
  const range = /^beats? (\d+)(?:\s*-\s*(\d+))?/.exec(lower);
  if (range) return {kind: 'beats', raw, fromBeat: beatId(range[1]!), toBeat: beatId(range[2] ?? range[1]!)};
  return {kind: 'unparsed', raw};
};

/** The crossing between two adjacent beats: the last third of the one before the cut and the first third of the one after, capped at `cap` frames in total. */
export const crossingSplit = (fromFrames: number, toFrames: number, cap: number): [number, number] => {
  const a0 = Math.floor(fromFrames / 3), b0 = Math.floor(toFrames / 3);
  const a = Math.min(a0, Math.floor(cap / 2));
  const b = Math.min(b0, cap - a);
  return [Math.min(a0, cap - b), b];
};

export const compileTimeline = (ledger: Ledger, options: CompileOptions = {}): Timeline => {
  const cap = options.crossingCap ?? 70;
  const {fps, beats} = ledger;
  if (!beats.length) throw new Error('timeline: the ledger has no beats');
  const ids = beats.map((b) => b.id);
  if (new Set(ids).size !== ids.length) throw new Error('timeline: beat ids must be unique');

  let seconds = 0;
  const spans = beats.map((b) => {
    const start = Math.round(seconds * fps);
    seconds += b.seconds;
    return {start, end: Math.round(seconds * fps)};
  });
  const durationInFrames = spans[spans.length - 1]!.end;
  if (ledger.durationInFrames !== undefined && ledger.durationInFrames !== durationInFrames) {
    throw new Error(`timeline: the beats sum to ${durationInFrames} frames, the ledger declares ${ledger.durationInFrames}`);
  }

  const out: TimelineBeat[] = beats.map((b, index) => {
    const {start, end} = spans[index]!;
    if (end <= start) throw new Error(`timeline: beat "${b.id}" has no frames`);
    const startOf = (id: string) => spans[ids.indexOf(id)]!.start;
    const endOf = (id: string) => spans[ids.indexOf(id)]!.end;
    const flips: StateFlip[] = (b.state ?? []).map((s) => {
      const scope = parseScope(s.scope, ids);
      const holds: [number, number] | null =
        scope.kind === 'permanent' ? [start, durationInFrames] : scope.kind === 'beats' ? [startOf(scope.fromBeat), endOf(scope.toBeat)] : scope.kind === 'until' ? [start, startOf(scope.beat)] : null;
      return {key: s.key, from: s.from, to: s.to, scope, frame: start, holds};
    });
    return {
      id: b.id,
      index,
      start,
      end,
      frames: end - start,
      world: worldIdOf(b.world),
      worldRaw: b.world,
      camera: b.camera ?? null,
      effects: b.effects ?? {},
      transitionIn: b.transition_in ?? null,
      transitionOut: b.transition_out ?? null,
      crossingIn: null,
      crossingOut: null,
      flips,
    };
  });

  const crossings: CrossingWindow[] = [];
  out.forEach((from, i) => {
    const to = out[i + 1];
    if (!to) return;
    const override = beats[i]!.crossing_frames;
    if (from.world === to.world && !override) return;
    const [a, b] = override ?? crossingSplit(from.frames, to.frames, cap);
    if (a > from.frames || b > to.frames) throw new Error(`timeline: crossing ${from.id} -> ${to.id} takes ${a}+${b} frames, more than a beat holds`);
    const start = from.end - a, end = to.start + b;
    from.crossingOut = [start, end];
    to.crossingIn = [start, end];
    crossings.push({from: from.id, to: to.id, fromWorld: from.world, toWorld: to.world, start, end, length: end - start, split: [a, b]});
  });

  out.forEach((b) => {
    if (b.crossingIn && b.crossingOut && b.crossingIn[1] > b.crossingOut[0]) throw new Error(`timeline: beat "${b.id}" is too short for the crossings on both its sides`);
  });
  return {fps, durationInFrames, beats: out, crossings};
};

/** The beat a frame belongs to (the last beat for a frame at or past the end). */
export const beatAt = (timeline: Timeline, frame: number): TimelineBeat => timeline.beats.find((b) => frame >= b.start && frame < b.end) ?? timeline.beats[timeline.beats.length - 1]!;

/** The crossing a frame is inside, if any. */
export const crossingAt = (timeline: Timeline, frame: number): CrossingWindow | undefined => timeline.crossings.find((c) => frame >= c.start && frame < c.end);
