/**
 * Keyframed tracks: the one place that decides which key a frame belongs to, how long a key holds, and what the drawn layer shows
 * between two keys. Pure in (track, frame, options). Nothing here knows what a value is: a pose, a camera, a colour and a number are all
 * `T` plus the `lerp` the caller passes in.
 *
 * Boundary (scripts/animation/check-boundary.mjs): this directory takes scenes, renderers and rigs as parameters and never imports them.
 */

/** Easing of the continuous blend between two keys (`sample` with `lerp` and no `breakdowns`). */
export type Ease = 'linear' | 'in' | 'out' | 'smooth' | ((t: number) => number);

/** A key. `hold`: frames the value is kept after `frame` before the move to the next key may begin. `ease` shapes the move that leaves this key. */
export type Key<T> = {frame: number; value: T; hold?: number; ease?: Ease};
export type Track<T> = {keys: Key<T>[]};

/**
 * A breakdown between two keys: from `frame`, show the value `favour` of the way from the previous key to the next (1/3 or 2/3, never 1/2).
 * `value`, when present, is the drawing itself: `sample` shows it as authored instead of blending `favour` of the way (a breakdown that
 * is an arc or an overshoot is not on the chord between the keys). Absent, the old behaviour: blend by `favour`.
 */
export type Breakdown<V = never> = {frame: number; favour: number; value?: V};

export type Quantise = 'ones' | 'twos';

export type SampleOptions<T> = {
  /** `twos` (default for the drawn layer) floors the frame to an even number; `ones` samples every frame. Default `ones`. */
  quantise?: Quantise;
  /** How two values blend. Without it a track only holds: the value of the key the frame has reached. */
  lerp?: (a: T, b: T, t: number) => T;
  /**
   * Pose-to-pose: between two keys the value is held, then jumps to a breakdown, then lands on the next key. An authored list applies to
   * the segments it has marks inside (marks outside a segment are ignored); a segment with none gets thirds. `'thirds'` ignores authored marks.
   * Needs `lerp`. Omitted with `lerp` = a continuous blend shaped by the key's `ease`.
   */
  breakdowns?: Breakdown<T>[] | 'thirds';
};

/** Floor `frame` to a multiple of `step` (twos by default): the drawn layer only updates on these frames. */
export const quantise = (frame: number, step = 2): number => Math.floor(frame / step) * step;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const eases: Record<Exclude<Ease, (t: number) => number>, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  smooth: (t) => t * t * (3 - 2 * t),
};

export const applyEase = (ease: Ease | undefined, t: number): number => (typeof ease === 'function' ? ease(t) : eases[ease ?? 'linear'](t));

/** The sorted keys of a track (a copy; tracks are authored in any order). */
export const sortedKeys = <T>(track: Track<T>): Key<T>[] => [...track.keys].sort((p, q) => p.frame - q.frame);

/** The two keys that bracket `frame` and the frame the move between them may begin. `to` is absent after the last key; `from` is the first key before the first. */
export const segmentAt = <T>(keys: Key<T>[], frame: number): {index: number; from: Key<T>; to: Key<T> | undefined; start: number} => {
  const first = keys[0];
  if (!first) throw new Error('segmentAt: a track needs at least one key');
  let index = -1;
  keys.forEach((k, n) => {
    if (k.frame <= frame) index = n;
  });
  const from = index < 0 ? first : keys[index]!;
  return {index, from, to: keys[index + 1], start: from.frame + (from.hold ?? 0)};
};

/** The breakdown marks inside the segment from `from` to `to`: authored ones if there are any, else thirds of the way from the end of the hold. */
export const marksIn = <T, V = never>(from: Key<T>, to: Key<T>, start: number, authored: Breakdown<V>[] | 'thirds' | undefined): Breakdown<V>[] => {
  const mine = authored === 'thirds' || !authored ? [] : authored.filter((b) => b.frame > from.frame && b.frame < to.frame);
  return mine.length ? mine : [1 / 3, 2 / 3].map((favour) => ({frame: quantise(Math.round(start + (to.frame - start) * favour)), favour}));
};

/**
 * The track's value at `frame`.
 * - no `lerp`: holds. The value of the last key at or before the frame.
 * - `lerp`, no `breakdowns`: from the end of a key's hold the value eases to the next key by that key's `ease`.
 * - `lerp` and `breakdowns`: the pose-to-pose rule above.
 * Before the first key the first key's value shows. The frame is quantised first, so a `twos` sample is constant over each pair of frames.
 */
export const sample = <T>(track: Track<T>, frame: number, options: SampleOptions<T> = {}): T => {
  const keys = sortedKeys(track);
  const f = options.quantise === 'twos' ? quantise(frame, 2) : frame;
  const {index, from, to, start} = segmentAt(keys, f);
  if (index < 0 || !to || !options.lerp) return from.value;
  if (options.breakdowns) {
    const active = marksIn(from, to, start, options.breakdowns)
      .filter((m) => m.frame <= f)
      .sort((p, q) => q.frame - p.frame)[0];
    return active ? (active.value !== undefined ? active.value : options.lerp(from.value, to.value, active.favour)) : from.value;
  }
  if (f <= start || to.frame <= start) return f >= to.frame ? to.value : from.value;
  return options.lerp(from.value, to.value, applyEase(from.ease, clamp01((f - start) / (to.frame - start))));
};

/** How many frames of `0..count-1` the sampled value differs from the previous frame's, by `same`. Reads a track's rhythm: ones change ~every frame, twos every other. */
export const changesIn = <T>(track: Track<T>, count: number, options: SampleOptions<T>, same: (a: T, b: T) => boolean): number => {
  let changed = 0;
  let prev = sample(track, 0, options);
  for (let f = 1; f < count; f++) {
    const v = sample(track, f, options);
    if (!same(prev, v)) changed++;
    prev = v;
  }
  return changed;
};
