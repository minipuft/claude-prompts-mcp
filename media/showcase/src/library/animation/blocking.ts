/**
 * Blocking: where the actors and props stand in the frame, per beat. A `Blocking` is plain numbers in screen pixels at the film's frame size
 * (1280x720 for the showcase); worlds read one passed in through their scene props instead of a module constant, so the same renderer can
 * draw the same scene at different places for different beats.
 *
 * v3/blocking/test-scene.json is the one every world was proved on (D78); v3/blocking/<beat-id>.json is a beat's own, `provisional` until its
 * layout sheet is approved. Between beats the placement eases on twos (`blockingTrack`).
 */
import {quantise, sample, type Track} from './track';

export type Box = {x: number; y: number; width: number; height: number};
/**
 * Where something stands for part of a beat. `at` are position keys in FILM frames: from the first key's frame the thing is at that key's `x`, `y` (a key without `y` keeps the base `y`) and between two keys it moves
 * from one to the next on twos, smoothly; before the first key it is at the base `x`, `y` the placement itself carries, which is therefore where the move STARTS (a Clawd who enters from the right has a base `x` off the
 * stage), and after the last key it stays on the last key. `probe-story.py` reads the same keys as a step function (the last key at or before the frame wins), so a key frame is a position both readers agree on.
 */
export type PlacementKey = {frame: number; x: number; y?: number};
/** `on` and `off` are absolute film frames, `off` exclusive: a prop that is not on stage before `on` or from `off` on (probe-story.py reads the same two fields). Both default to the beat's own range. */
export type Presence = {on?: number; off?: number};
/** Where an actor that has no dedicated field (box, gadget, structure, bubble, stalk, heap) stands: an anchor point in screen pixels and a scale. */
export type ActorPlacement = {x: number; y: number; scale: number; facing?: 'left' | 'right'} & Presence & {at?: PlacementKey[]} & ActorState;
/**
 * What an actor carries beyond where it stands (the scaffold beats, 5-8): `carriedBy` names who holds it while that one travels (`figure.at` for the human, `clawd.at` for Clawd): the prop stands at its own `x`, `y` and
 * moves with the carrier's offset from the carrier's last key, as the frame does with `frame.carriedBy`. `openAt` keys how far the thing is open (0 shut, 1 open: the stalk's leaf), linear between keys, held at the first before it
 * and at the last after it; the resolved placement carries the number as `open`. `lit` says the beat's emitter sits on this actor from frame `from` (until another actor's `from` takes over), `offset` being where on it in the
 * actor's native px at scale 1 (the leaf of the stalk): a light that follows the thing the story point wants the eye on. Its strength and size stay the beat's `emitter.at` keys. `madeBy` tags whose work the thing is. `standsOn` names what a prop that stands rests on when that is not the floor (a stalk set into the blocks): `probe-blocking.py` then asks for no foot on the floor line.
 */
export type ActorState = {carriedBy?: 'human' | 'clawd'; openAt?: {frame: number; value: number}[]; open?: number; lit?: {from: number; offset?: [number, number]}; madeBy?: 'human'; standsOn?: string};
/**
 * A key of the emitter's glow in film frames: `radius` (stage px, the animatic's settled 260 where a beat has none) and `strength` (a multiple of the light contract's intensity, 1 where a beat has none). Each field is read on its own keys:
 * smooth between two keys that carry it, held at the first before it and at the last after it. `glowAt` reads them; a beat with no keys draws the settled glow.
 */
export type GlowKey = {frame: number; radius?: number; strength?: number};
/** The beat's light: where the emitter starts and ends across the beat (screen pixels) and the thing it sits on. Colour and timing belong to the light contract; `at` keys the size and strength of the glow (a seam that widens after the lid, a dial that goes wide at the pop). */
export type EmitterPath = {start: [number, number]; end: [number, number]; anchor: string; at?: GlowKey[]; /** `frame`: the light travels with the frame it sits in, by the frame's displacement from where it ends (a frame carried in). `start` and `end` are where it sits once the frame has arrived. */ follows?: 'frame'};
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
  contacts?: {a: string; b: string; why: string; /** The film frame the two touch on, when they touch at one moment (a foot against a heap). */ frame?: number; /** What the touch moves: the named thing's anchor shifts by `by[0]` to `by[1]` pixels (`probe-blocking.py` measures it from the `at` keys). */ moves?: {actor: string; by: [number, number]}}[];
  /**
   * The human: HumanPuppet canvas scale and the canvas's top-left. `order` (part names of the parts rig, front first) draws the human as the parts rig in that order and draws only the parts it lists: the animatic sets it on the
   * frames of a shot whose pose sheet drops a garment (`animaticPlan`), so a part left out is a garment that is off. `swoop` draws the one-piece figure without its poncho (the contour worlds and every frame after the drop that
   * has no `order`): the garment flip of beats-v2 is permanent. Neither is ever in a blocking file.
   */
  figure: {scale: number; x: number; y: number; order?: readonly string[]; swoop?: boolean; /** The human's root travel: position keys on the canvas's top-left (`x`, `y` are where the move starts). The animatic reads them on the frame each drawing came on, so the layer changes only where the exposure sheet has a row. */ at?: PlacementKey[]};
  /** `hold` freezes Codex's boil on the variant of frame `from` for the frames `from` to `to` (exclusive): a held wince is one drawing, not a shimmer (film frames). */
  codex: {x: number; y: number; scale: number; at?: PlacementKey[]; hold?: {from: number; to: number}};
  /** `raise` (0..1, default 0.2) is how far the arm that holds the frame is lifted. */
  clawd: {x: number; y: number; scale: number; raise?: number; at?: PlacementKey[]};
  /**
   * `carriedBy` names who holds the frame while it moves: the frame stands at its own `x`, `y` once its carrier has stopped, and until then it travels with the carrier's offset from the carrier's last key
   * (so the frame's own box is where it ends, which is what the eye trace and the story probe read). `at` moves the frame by itself.
   * A beat with no `frame` draws none: the frame is the portal (th-frame-portal), absent from every frame before Clawd carries it in at sp-4.2 (beats 1-3 carry no `frame`; beat 4's stands off the picture until its carrier brings it).
   */
  frame?: Box & {at?: PlacementKey[]; carriedBy?: 'clawd'; /** The beat's emitter sits in the middle of the frame from this film frame (a window the light looks through: sp-7.4, sp-8.3), until an actor's `lit.from` is later. */ litFrom?: number};
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
  /** How grainy the light is across the beat: `amount` (the speckle's alpha, 0.05 is the settled grain) at film frames, linear between keys, the first before the first key and the last after it. Absent: the settled grain. `grainAt` reads it. */
  grain?: {frame: number; amount: number}[];
  /** The emitter's path across the beat. Absent in the test scene; present in every beat file. */
  emitter?: EmitterPath;
  /** The composition card (an id on v3/references/board.json) the staging borrows its framing from. */
  card?: string;
  /** The beat is entered by a cut, not by the 24-frame ease of the placements of the beat before it (a restaging that changes the picture's scale: Codex and Clawd would otherwise shrink inside the last second of the beat before). */
  cutIn?: boolean;
  /** The beat is left by a cut: it keeps its own placements to its last frame instead of easing into the next beat's for the last 24 frames. */
  cutOut?: boolean;
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

const presence = (v: Record<string, unknown>, path: string): void => {
  for (const k of ['on', 'off'] as const) if (v[k] !== undefined) num(v[k], `${path}.${k}`);
  if (typeof v.on === 'number' && typeof v.off === 'number' && v.off <= v.on) throw new Error(`blocking: ${path} goes off at ${v.off}, not after it comes on at ${v.on}`);
};

/** The scaffold beats' actor fields (`ActorState`): a carrier named, open keys ascending and numeric, a lit-from frame and its offset. */
const actorState = (v: Record<string, unknown>, path: string): void => {
  if (v.carriedBy !== undefined && v.carriedBy !== 'human' && v.carriedBy !== 'clawd') throw new Error(`blocking: ${path}.carriedBy must be "human" or "clawd", got ${JSON.stringify(v.carriedBy)}`);
  if (v.standsOn !== undefined && (typeof v.standsOn !== 'string' || !v.standsOn)) throw new Error(`blocking: ${path}.standsOn must name what the prop rests on`);
  if (v.madeBy !== undefined && v.madeBy !== 'human') throw new Error(`blocking: ${path}.madeBy must be "human", got ${JSON.stringify(v.madeBy)}`);
  if (v.openAt !== undefined) {
    if (!Array.isArray(v.openAt) || !v.openAt.length) throw new Error(`blocking: ${path}.openAt must be a non-empty list of {frame, value}`);
    v.openAt.forEach((k, i) => {
      num((k as Record<string, unknown>)?.frame, `${path}.openAt[${i}].frame`);
      num((k as Record<string, unknown>)?.value, `${path}.openAt[${i}].value`);
      if (i && (k as {frame: number}).frame <= (v.openAt as {frame: number}[])[i - 1]!.frame) throw new Error(`blocking: ${path}.openAt must run in ascending frames (key ${i} is at ${(k as {frame: number}).frame})`);
    });
  }
  if (v.lit !== undefined) {
    const lit = v.lit as Record<string, unknown> | null;
    if (typeof lit !== 'object' || lit === null) throw new Error(`blocking: ${path}.lit must be {from, offset?}`);
    num(lit.from, `${path}.lit.from`);
    if (lit.offset !== undefined && (!Array.isArray(lit.offset) || lit.offset.length !== 2)) throw new Error(`blocking: ${path}.lit.offset must be [x, y]`);
  }
};

const placementKeys = (v: Record<string, unknown>, path: string): void => {
  if (v.at === undefined) return;
  if (!Array.isArray(v.at) || !v.at.length) throw new Error(`blocking: ${path}.at must be a non-empty list of {frame, x, y?}`);
  v.at.forEach((k, i) => {
    num((k as Record<string, unknown>)?.frame, `${path}.at[${i}].frame`);
    num((k as Record<string, unknown>)?.x, `${path}.at[${i}].x`);
    if ((k as Record<string, unknown>).y !== undefined) num((k as Record<string, unknown>).y, `${path}.at[${i}].y`);
    if (i && (k as PlacementKey).frame <= (v.at as PlacementKey[])[i - 1]!.frame) throw new Error(`blocking: ${path}.at must run in ascending frames (key ${i} is at ${(k as PlacementKey).frame})`);
  });
};

/** A blocking file read as a `Blocking`, or an error naming the first field that is missing or not a number. A silent default would hide a wrong file. */
export const parseBlocking = (json: unknown): Blocking => {
  const b = json as Record<string, unknown>;
  if (typeof b?.id !== 'string') throw new Error('blocking: id must be a string');
  group(b.figure, 'figure', ['scale', 'x', 'y']);
  group(b.codex, 'codex', ['x', 'y', 'scale']);
  group(b.clawd, 'clawd', ['x', 'y', 'scale']);
  if (b.frame !== undefined) group(b.frame, 'frame', ['x', 'y', 'width', 'height']);
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
      presence(placed, `actors.${name}`);
      placementKeys(placed, `actors.${name}`);
      actorState(placed, `actors.${name}`);
    }
  }
  for (const who of ['codex', 'clawd', 'frame', 'figure'] as const) if (b[who] !== undefined) placementKeys(b[who] as Record<string, unknown>, who);
  const held = (b.codex as Record<string, unknown>).hold as Record<string, unknown> | undefined;
  if (held !== undefined) {
    num(held?.from, 'codex.hold.from');
    num(held?.to, 'codex.hold.to');
    if ((held!.to as number) <= (held!.from as number)) throw new Error(`blocking: codex.hold runs from ${held!.from} to ${held!.to}, which is not after it starts`);
  }
  if (b.clawd && (b.clawd as Record<string, unknown>).raise !== undefined) num((b.clawd as Record<string, unknown>).raise, 'clawd.raise');
  if (b.frame && (b.frame as Record<string, unknown>).litFrom !== undefined) num((b.frame as Record<string, unknown>).litFrom, 'frame.litFrom');
  if (b.frame && (b.frame as Record<string, unknown>).carriedBy !== undefined && (b.frame as Record<string, unknown>).carriedBy !== 'clawd') throw new Error(`blocking: frame.carriedBy must be "clawd", got ${JSON.stringify((b.frame as Record<string, unknown>).carriedBy)}`);
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
    if (e.at !== undefined) {
      if (!Array.isArray(e.at) || !e.at.length) throw new Error('blocking: emitter.at must be a non-empty list of {frame, radius?, strength?}');
      e.at.forEach((k, i) => {
        const key = k as Record<string, unknown>;
        num(key?.frame, `emitter.at[${i}].frame`);
        if (key.radius === undefined && key.strength === undefined) throw new Error(`blocking: emitter.at[${i}] keys neither a radius nor a strength`);
        if (key.radius !== undefined) {
          num(key.radius, `emitter.at[${i}].radius`);
          if ((key.radius as number) <= 0) throw new Error(`blocking: emitter.at[${i}].radius must be above 0, got ${key.radius}`);
        }
        if (key.strength !== undefined) {
          num(key.strength, `emitter.at[${i}].strength`);
          if ((key.strength as number) < 0) throw new Error(`blocking: emitter.at[${i}].strength must not be negative, got ${key.strength}`);
        }
        if (i && (key.frame as number) <= ((e.at as {frame: number}[])[i - 1]!.frame)) throw new Error(`blocking: emitter.at must run in ascending frames (key ${i} is at ${key.frame})`);
      });
    }
    if (e.follows !== undefined && e.follows !== 'frame') throw new Error(`blocking: emitter.follows must be "frame", got ${JSON.stringify(e.follows)}`);
    if (e.follows === 'frame' && b.frame === undefined) throw new Error('blocking: emitter.follows "frame" needs a frame in the beat');
  }
  if (b.grain !== undefined) {
    if (!Array.isArray(b.grain) || !b.grain.length) throw new Error('blocking: grain must be a non-empty list of {frame, amount}');
    b.grain.forEach((k, i) => {
      num((k as Record<string, unknown>)?.frame, `grain[${i}].frame`);
      num((k as Record<string, unknown>)?.amount, `grain[${i}].amount`);
      if (i && (k as {frame: number}).frame <= (b.grain as {frame: number}[])[i - 1]!.frame) throw new Error(`blocking: grain must run in ascending frames (key ${i} is at ${(k as {frame: number}).frame})`);
    });
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

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** The position keys' value on `frame`: the base before the first key, the last key after it, a smooth move between two keys. `x` and `y` of `base` are the start. */
const placedAt = (base: {x: number; y: number}, keys: PlacementKey[] | undefined, frame: number): {x: number; y: number} => {
  if (!keys?.length || frame < keys[0]!.frame) return {x: base.x, y: base.y};
  let i = 0;
  keys.forEach((k, n) => {
    if (k.frame <= frame) i = n;
  });
  const from = keys[i]!, to = keys[i + 1];
  const fromY = from.y ?? base.y;
  if (!to) return {x: from.x, y: fromY};
  const t = smooth((frame - from.frame) / (to.frame - from.frame));
  return {x: from.x + (to.x - from.x) * t, y: fromY + ((to.y ?? base.y) - fromY) * t};
};

/** How open a thing is on `frame` by its `openAt` keys: linear between two keys, the first value before the first and the last after the last; undefined for a thing with no keys. */
const openAtFrame = (keys: {frame: number; value: number}[] | undefined, frame: number): number | undefined => {
  if (!keys?.length) return undefined;
  if (frame <= keys[0]!.frame) return keys[0]!.value;
  const i = keys.findIndex((k) => k.frame > frame);
  if (i < 0) return keys[keys.length - 1]!.value;
  const a = keys[i - 1]!, c = keys[i]!;
  return a.value + ((c.value - a.value) * (frame - a.frame)) / (c.frame - a.frame);
};

/**
 * The blocking as it stands on `frame` (a film frame): a prop that is not on stage on it is gone, and everything with position keys is where its keys put it. The result carries no `on`, `off`, `at` or `carriedBy` (the human's `figure` too has its `at` keys resolved),
 * so resolving it again changes nothing. The frame carried by Clawd stands where Clawd's last key puts it and travels with Clawd's offset from that key until then.
 */
export const resolveBlocking = (b: Blocking, frame: number): Blocking => {
  const strip = <T extends object>(o: T): Omit<T, 'at' | 'on' | 'off' | 'carriedBy' | 'openAt'> => {
    const {at: _at, on: _on, off: _off, carriedBy: _carried, openAt: _openAt, ...rest} = o as T & {at?: unknown; on?: unknown; off?: unknown; carriedBy?: unknown; openAt?: unknown};
    return rest;
  };
  const codexAt = placedAt(b.codex, b.codex.at, frame), clawdAt = placedAt(b.clawd, b.clawd.at, frame);
  const clawdEnd = b.clawd.at?.length ? placedAt(b.clawd, b.clawd.at, Infinity) : {x: b.clawd.x, y: b.clawd.y};
  const figureAt = placedAt(b.figure, b.figure.at, frame);
  const figureEnd = b.figure.at?.length ? placedAt(b.figure, b.figure.at, Infinity) : {x: b.figure.x, y: b.figure.y};
  /** Where a prop carried by `who` is shifted to: the carrier's offset from its last key (none for a prop nobody carries). */
  const carried = (who: ActorState['carriedBy']): {x: number; y: number} => (who === 'human' ? {x: figureAt.x - figureEnd.x, y: figureAt.y - figureEnd.y} : who === 'clawd' ? {x: clawdAt.x - clawdEnd.x, y: clawdAt.y - clawdEnd.y} : {x: 0, y: 0});
  const carry = b.frame?.carriedBy === 'clawd' ? {x: clawdAt.x - clawdEnd.x, y: clawdAt.y - clawdEnd.y} : {x: 0, y: 0};
  const {frame: base, ...rest} = b;
  const own = base ? placedAt(base, base.at, frame) : null;
  const framed = base && own ? {frame: {...strip(base), x: own.x + carry.x, y: own.y + carry.y}} : {};
  const actors = b.actors
    ? Object.fromEntries(
        Object.entries(b.actors)
          .filter(([, a]) => (a.on ?? -Infinity) <= frame && (a.off === undefined || frame < a.off))
          .map(([name, a]) => {
            const own = placedAt(a, a.at, frame), shift = carried(a.carriedBy), open = openAtFrame(a.openAt, frame);
            return [name, {...strip(a), ...(open !== undefined ? {open} : {}), x: own.x + shift.x, y: own.y + shift.y}];
          }),
      )
    : undefined;
  return {
    ...rest,
    codex: {...strip(b.codex), ...codexAt},
    clawd: {...strip(b.clawd), ...clawdAt},
    ...framed,
    figure: {...strip(b.figure), ...figureAt},
    figureCrop: {...b.figureCrop, x: b.figureCrop.x + figureAt.x - b.figure.x, y: b.figureCrop.y + figureAt.y - b.figure.y},
    ...(actors ? {actors} : {}),
  };
};

/**
 * A blocking per beat as a track: each beat holds its own placement until `ease` frames before the next beat starts, then eases to the next
 * on twos (a drawn layer: the placement steps, it does not glide).
 */
export const blockingTrack = (beats: {id: string; start: number; end: number}[], byBeat: Record<string, Blocking>, ease = 24): Track<Blocking> => ({
  keys: beats.map((beat, i) => {
    const value = byBeat[beat.id];
    if (!value) throw new Error(`blocking: no blocking for beat "${beat.id}"`);
    const into = beats[i + 1] ? byBeat[beats[i + 1]!.id] : undefined;
    return {frame: beat.start, value, hold: Math.max(0, beat.end - beat.start - (into?.cutIn || value.cutOut ? 0 : ease)), ease: 'smooth' as const};
  }),
});

/**
 * The blocking on `frame`, on twos: the beat's own placement (or the blend of two beats' during an ease) with every prop's presence and every position key resolved at that frame. Both sides of an ease are resolved at the
 * same frame before they are blended, so a prop that is on stage in one beat and not yet in the next blends as the beat it is in.
 */
export const blockingAt = (track: Track<Blocking>, frame: number): Blocking => {
  const f = quantise(frame, 2);
  return resolveBlocking(sample(track, f, {quantise: 'twos', lerp: (a, b, t) => lerpBlocking(resolveBlocking(a, f), resolveBlocking(b, f), t)}), f);
};

/** The grain amount on `frame` of a beat (`blocking.grain`), or undefined for the settled grain: linear between keys, held before the first and after the last. */
export const grainAt = (blocking: Blocking, frame: number): number | undefined => {
  const keys = blocking.grain;
  if (!keys?.length) return undefined;
  if (frame <= keys[0]!.frame) return keys[0]!.amount;
  const i = keys.findIndex((k) => k.frame > frame);
  if (i < 0) return keys[keys.length - 1]!.amount;
  const a = keys[i - 1]!, b = keys[i]!;
  return a.amount + ((b.amount - a.amount) * (frame - a.frame)) / (b.frame - a.frame);
};

/** One field of the emitter's glow keys on `frame`: smooth between the two keys that carry it, held before the first and after the last, undefined where no key carries it. */
const glowField = (keys: GlowKey[], field: 'radius' | 'strength', frame: number): number | undefined => {
  const carrying = keys.filter((k) => k[field] !== undefined);
  if (!carrying.length) return undefined;
  const i = carrying.findIndex((k) => k.frame > frame);
  if (i < 0) return carrying[carrying.length - 1]![field];
  if (i === 0) return carrying[0]![field];
  const a = carrying[i - 1]!, b = carrying[i]!;
  return a[field]! + (b[field]! - a[field]!) * smooth((frame - a.frame) / (b.frame - a.frame));
};

/** The size and strength of the emitter's glow on `frame` of a beat (`emitter.at`): each is undefined where the beat keys none, and the settled glow is drawn. `blocking` is the beat's file. */
export const glowAt = (blocking: Blocking, frame: number): {radius?: number; strength?: number} => {
  const keys = blocking.emitter?.at;
  if (!keys?.length) return {};
  return {radius: glowField(keys, 'radius', frame), strength: glowField(keys, 'strength', frame)};
};

/** The emitter's position on `frame` of a beat: a straight line from `start` to `end` across the beat, on ones (light is not a drawn layer), moved with the frame it follows. Null when the beat has none. `blocking` is the beat's file, not its resolved placement. */
export const emitterPointAt = (blocking: Blocking, beat: {start: number; end: number}, frame: number): {x: number; y: number} | null => {
  const e = blocking.emitter;
  if (!e) return null;
  const t = beat.end - beat.start <= 1 ? 0 : Math.max(0, Math.min(1, (frame - beat.start) / (beat.end - beat.start - 1)));
  const carried = e.follows === 'frame' ? resolveBlocking(blocking, frame).frame : blocking.frame;
  const shift = carried && blocking.frame ? {x: carried.x - blocking.frame.x, y: carried.y - blocking.frame.y} : {x: 0, y: 0};
  return {x: e.start[0] + (e.end[0] - e.start[0]) * t + shift.x, y: e.start[1] + (e.end[1] - e.start[1]) * t + shift.y};
};

/**
 * Where the beat's emitter sits because an actor carries it (`lit`): the anchor of the actor whose `lit.from` is the latest at or before `frame` among those on stage, moved by its `offset` (native px at scale 1, mirrored for an actor that faces left),
 * or null when no actor does (the beat's own path then applies). `resolved` is the blocking as `resolveBlocking` leaves it on `frame`, `blocking` the beat's file (the resolved actors drop nothing the light needs, but `lit` is read from the file so a
 * resolved copy cannot lose it).
 */
export const litPointAt = (blocking: Blocking, resolved: Blocking, frame: number): {x: number; y: number; actor: string} | null => {
  let best: {from: number; name: string} | null = null;
  for (const [name, a] of Object.entries(blocking.actors ?? {})) {
    if (!a.lit || a.lit.from > frame || !resolved.actors?.[name]) continue;
    if (!best || a.lit.from > best.from) best = {from: a.lit.from, name};
  }
  const win = blocking.frame?.litFrom, shown = resolved.frame;
  if (win !== undefined && win <= frame && shown && (!best || win > best.from)) return {x: shown.x + shown.width / 2, y: shown.y + shown.height / 2, actor: 'frame'};
  if (!best) return null;
  const file = blocking.actors![best.name]!, here = resolved.actors![best.name]!, off = file.lit!.offset ?? [0, 0];
  const sx = file.facing === 'left' ? -1 : 1;
  return {x: here.x + sx * off[0] * here.scale, y: here.y + off[1] * here.scale, actor: best.name};
};
