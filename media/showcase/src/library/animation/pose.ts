/**
 * The pose pass: what a key MEANS beyond the numbers in it (v3/poses/<shot>.json), and the pure functions that read and generate it. A key sheet
 * holds joints; a pose sheet holds the line of action each key draws, where the weight sits, which limb leads, what the breakdowns do off the chord
 * (arcs, anticipation, overshoot), which parts trail the body (secondaries) and which holds drift (moving holds). `poseChartFrom` turns the two into
 * the chart `poseAt` plays; `scripts/animation/probe-poses.py` and `probe-inbetweens.py` measure the same contract from the files and the frames.
 *
 * Conventions shared with the probes (scripts/animation/probe_common.py repeats the spine constants; change both or neither):
 * - screen space, y down. "Right of a direction" is the clockwise side on screen: for a spine pointing up it is image-right.
 * - `L` and `R` name the figure's joints as the rig does (`wristL` is image-left).
 * Pure in its arguments. Boundary (scripts/animation/check-boundary.mjs): this file takes the rig as parameters and imports no cast, world or prop.
 */
import {blendPose, poseAt, virtualJoint, type Joints, type PoseChart, type PoseFollow} from '../motion';
import {PART_NAMES, type PartName} from '../motion/partsRig';
import type {KeySheet} from './keys';
import {MATERIAL_IDS, materialOf, motionOf, type MaterialId} from './materials';
import {followOf} from './secondaries';
import {quantise} from './track';

// ---------- contract ----------

export type LineClass = 'C' | 'S' | 'I';
export type Silhouette = 'open' | 'closed' | 'star' | 'fold' | 'line';
export type Side = 'L' | 'R';
export type LineOfAction = {
  class: LineClass;
  /** Largest perpendicular deviation of the spine curve from the root-to-head chord, as a fraction of `heightPx`. 0.04-0.35 for C and S; below 0.04 for I. */
  bow: number;
  /** Which side the bow goes: +1 the right of root-to-head (image-right for an upright spine), -1 the left. For an S, the side of the lobe nearer the root. */
  sign: 1 | -1;
  /** S only: where the two lobes cross, 0 (root) to 1 (head) along the chord. Default 0.5. */
  inflection?: number;
  /** Degrees the root-to-head chord leans clockwise from vertical (positive leans image-right). Default 0. Only `solvePose` reads it. */
  lean?: number;
};
export type PoseKey = {
  name: string;
  frame: number;
  hold?: number;
  /** One sentence: the script moment this key carries. */
  moment: string;
  lineOfAction: LineOfAction;
  weight: {foot: Side | 'both'; /** 0-1: how far the root sits over that foot (0 over the other foot, 1 directly over this one; ignored for `both`). */ over: number};
  lead: {arm: Side | 'none'; leg: Side | 'none'};
  /** An intentional symmetric pose must say why. */
  twinned?: {why: string};
  silhouette: Silhouette;
  face?: string;
  plateFamily?: string;
  /** Parts of the parts rig (src/library/motion/partsRig.ts) drawn in this order, front first, over the order the rule derives from the solved joints (`defaultOrder`): the parts listed exchange the places the rule gave them, in the order listed; the others keep theirs. Absent: the rule's order. */
  order?: PartName[];
  /** The joints `solvePose` draws for this spec (`npm run solve-poses -- <shot>` writes them), in the key sheet's space; `probe-poses.py --joints solved` measures them. */
  solved?: Joints;
  /** ISO date `solved` was written. */
  solvedAt?: string;
};
export type BreakdownKind = 'passing' | 'anticipation' | 'overshoot' | 'settle';
export type PoseBreakdown = {
  between: [string, string];
  frame: number;
  /** 0-1, never 0.5. `passing` and `settle`: the share of the way from the first key to the second. `anticipation` and `overshoot`: how far past the key the drawing goes, as `favour` x 0.25 of the move (see `breakdownPose`). */
  favour: number;
  kind: BreakdownKind;
  /** The joint that leaves the chord, and by how many pixels (key-sheet space), signed: positive is the right of that joint's chord from the first key to the second. */
  arc: {joint: string; offsetPx: number};
  /** An authored drawing (every joint of the key sheet). Absent: the solver builds it from the keys and `arc`. */
  joints?: Joints;
  /** This drawing is a contact (a heel on the floor, a hand on a ledge) of the named material, which declares `contact`: the move's `settle` drawing follows it by that many frames (`contactFaults`). */
  contact?: MaterialId;
};
export type Secondary = {
  name: string;
  /** The side (`L` or `R`) whose arm this part is: it does not lag on a move that side leads (the to-key's `lead.arm`), where it moves with the body. */
  side?: Side;
  joints: string[];
  /**
   * Drawings on twos (2 frames each) the part arrives after the body: 1-3. A shot drawn on fours lags one of its own drawings with 2, so the part changes on the body's frames and not between them.
   * With a `material` this is only a floor the material must clear (`parsePoseSheet` refuses a material that trails less) and may be left out; without one it is the lag, delayed by hand.
   */
  lagDrawings?: number;
  /** 0-1 (default 0): 0 rides the parent and lags only in angle (a limb), 1 stays where it was in the world and the bone stretches to reach it (cloth); see `PoseLag`. */
  stretch?: number;
  /**
   * What the part is made of (`v3/materials.json`, D97): its lag, settle and overshoot are the material's chain driven by the primary joint's path over the whole sheet (`followOf`, stepped on ones,
   * drawn on twos), and not a delay written here. The material must declare a lag and a settle.
   */
  material?: MaterialId;
  /** A joint the rig does not have, which `joints` (one name) then names: `offset` px from joint `at`, in the frame of the `away` -> `at` bone (up is 0). Needs a `material`. */
  tip?: {at: string; away: string; offset: [number, number]};
  /** The frame the part stops being the figure's and becomes a prop that stays (a cloak dropped on the floor): from it the part no longer follows, and no move that starts on or after it lags it. Needs a `material`. */
  dropsAt?: number;
};
export type MovingHold = {key: string; /** Pixels of drift (key-sheet space), 2-6. */ driftPx: number; /** Frames the drift runs over, from the key landing. */ over: number};
export type PoseSheet = {
  shot: string;
  actor: string;
  provisional?: boolean;
  note?: string;
  /** Figure height in the key sheet's space (the space `v3/keys/<shot>.json` joints are in). Every `bow` and every pixel threshold is read against it. */
  heightPx: number;
  source: {chart: string; keys: string; layout: string};
  keys: PoseKey[];
  breakdowns: PoseBreakdown[];
  secondaries: Secondary[];
  movingHolds: MovingHold[];
};

/** The measuring constants of the spine fit. `scripts/animation/probe_common.py` carries the same values (SPINE_*). */
export const SPINE_FIT = {
  /** Ridge on the S-shaped term of the fit: the spine joints bunch near the head, so the lower lobe is weakly observed and an unregularised fit swings by tens of percent of the figure on 2 px of noise. */
  ridge: 0.05,
  /** Peak of t(1-t)(1-2t), which normalises the S term to 1. */
  sPeak: 0.0962250449,
  /** A spine whose bow is below this is straight: class I. */
  straightBow: 0.04,
  /** Each lobe of an S must reach this fraction of the figure. */
  lobe: 0.03,
  samples: 201,
} as const;
export const BOW_RANGE: [number, number] = [SPINE_FIT.straightBow, 0.35];
export const CLASSES: readonly LineClass[] = ['C', 'S', 'I'];
export const SILHOUETTES: readonly Silhouette[] = ['open', 'closed', 'star', 'fold', 'line'];
export const BREAKDOWN_KINDS: readonly BreakdownKind[] = ['passing', 'anticipation', 'overshoot', 'settle'];
/** A move of anticipation or overshoot reaches `favour` x this share of the key-to-key move past the key. */
export const REACH_PAST = 0.25;

/**
 * The timing shape of a move (rubric C28), declared in the pose sheet and checked from it. A MOVE runs from the end of a key's hold to the next key; its drawings are the
 * breakdowns the chart plays there (authored, or the two thirds `marksIn` adds when none is authored). The shape is: 3-6 drawings; at most one `anticipation` (a drawing
 * BEFORE the from-key along the chord), at most one `overshoot` (past the to-key), at most one `settle`; any number of `passing`; and by frame
 * anticipation < passing < overshoot < settle. Positions are along the chord from the first key (0) to the second (1): see `chordPosition`.
 */
export const TIMING_SHAPE = {
  drawings: [3, 6] as [number, number],
  position: {anticipation: [-0.15, -0.05], passing: [0.25, 0.75], overshoot: [1.05, 1.15], settle: [0.9, 1]} as Record<BreakdownKind, [number, number]>,
} as const;
const KIND_RANK: Record<BreakdownKind, number> = {anticipation: 0, passing: 1, overshoot: 2, settle: 3};
const EPS = 1e-9;

/** Where along the chord (first key 0, second key 1) a breakdown draws: `passing` and `settle` at `favour`; `anticipation` at -0.25 x favour; `overshoot` at 1 + 0.25 x favour (the stored favour is always positive). */
export const chordPosition = (b: {kind: BreakdownKind; favour: number}): number => (b.kind === 'anticipation' ? -REACH_PAST * b.favour : b.kind === 'overshoot' ? 1 + REACH_PAST * b.favour : b.favour);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * A pose sheet read from JSON, or an error naming the first wrong thing: an unknown class, silhouette or breakdown kind; a bow outside 0.04-0.35
 * (class I: below 0.04); a favour of 0.5 or outside 0-1; a breakdown that names an unknown key, names keys out of order or sits outside the
 * frames between them; a secondary whose lag is not 1-3 drawings or whose `stretch` is outside 0-1; a moving hold off a key or outside 2-6 px; a key with no `moment`; a symmetric
 * (`twinned`) key with no `why`. Names and frames of keys must be unique.
 * The timing shape (`TIMING_SHAPE`, `timingFaults`) is refused too. Per breakdown, a position along the chord outside its kind's band: `anticipation` -0.15 to -0.05 (favour
 * 0.2-0.6), `passing` 0.25-0.75, `overshoot` 1.05-1.15 (favour 0.2-0.6), `settle` 0.9 or more. Per move, between a key's hold end and the next key: not 3-6 drawings, a breakdown
 * inside the hold, a breakdown whose `between` is not the two keys its frame sits between, two drawings on one frame, two consecutive drawings with one favour, more than one anticipation, overshoot or settle, kinds
 * out of the order anticipation, passing, overshoot, settle by frame, and passing positions that do not rise. The lead arm contract (`leadArmFaults`) is refused too: on a move, the shoulder,
 * elbow or wrist of the to-key's `lead.arm` in a secondary that lags on it (a secondary lags on every move except those its `side` leads, where `poseChartFrom` does not lag it).
 */
export const parsePoseSheet = (json: unknown): PoseSheet => {
  if (!isObj(json)) throw new Error('poses: the sheet must be an object');
  const s = json as unknown as PoseSheet;
  if (typeof s.shot !== 'string' || typeof s.actor !== 'string') throw new Error('poses: shot and actor must be strings');
  if (!(isNum(s.heightPx) && s.heightPx > 0)) throw new Error(`poses: ${s.shot} needs heightPx > 0 (the figure height in the key sheet's space)`);
  if (!isObj(s.source) || ['chart', 'keys', 'layout'].some((k) => typeof (s.source as Record<string, unknown>)[k] !== 'string')) throw new Error(`poses: ${s.shot} source must name chart, keys and layout`);
  if (!Array.isArray(s.keys) || !s.keys.length) throw new Error(`poses: ${s.shot} has no keys`);
  const names = new Map<string, PoseKey>(), frames = new Set<number>();
  for (const k of s.keys) {
    const at = `poses: key "${k?.name}"`;
    if (typeof k.name !== 'string' || !Number.isInteger(k.frame)) throw new Error('poses: every key needs a name and an integer frame');
    if (names.has(k.name)) throw new Error(`poses: key name "${k.name}" is used twice`);
    if (frames.has(k.frame)) throw new Error(`${at} shares frame ${k.frame} with another key`);
    if (typeof k.moment !== 'string' || !k.moment.trim()) throw new Error(`${at} has no moment (one sentence: the script moment it carries)`);
    const l = k.lineOfAction;
    if (!l || !CLASSES.includes(l.class)) throw new Error(`${at} has an unknown line-of-action class ${JSON.stringify(l?.class)}; use C, S or I`);
    if (!isNum(l.bow)) throw new Error(`${at} bow must be a number`);
    if (l.class === 'I' ? !(l.bow >= 0 && l.bow < BOW_RANGE[0]) : !(l.bow >= BOW_RANGE[0] && l.bow <= BOW_RANGE[1])) {
      throw new Error(`${at} bow ${l.bow} is outside ${l.class === 'I' ? `0-${BOW_RANGE[0]} (class I is a straight line)` : `${BOW_RANGE[0]}-${BOW_RANGE[1]}`} of the figure height`);
    }
    if (l.sign !== 1 && l.sign !== -1) throw new Error(`${at} sign must be 1 or -1`);
    if (l.inflection !== undefined && (l.class !== 'S' || !(l.inflection > 0 && l.inflection < 1))) throw new Error(`${at} inflection belongs to class S and must be between 0 and 1`);
    if (!['L', 'R', 'both'].includes(k.weight?.foot) || !(k.weight.over >= 0 && k.weight.over <= 1)) throw new Error(`${at} weight needs foot L, R or both and over between 0 and 1`);
    if (!['L', 'R', 'none'].includes(k.lead?.arm) || !['L', 'R', 'none'].includes(k.lead?.leg)) throw new Error(`${at} lead needs arm and leg of L, R or none`);
    if (k.twinned !== undefined && !(typeof k.twinned.why === 'string' && k.twinned.why.trim())) throw new Error(`${at} is twinned but says no why`);
    if (!SILHOUETTES.includes(k.silhouette)) throw new Error(`${at} has an unknown silhouette ${JSON.stringify(k.silhouette)}`);
    if (k.order !== undefined && !(Array.isArray(k.order) && k.order.length >= 2 && k.order.every((n) => PART_NAMES.includes(n)) && new Set(k.order).size === k.order.length)) {
      throw new Error(`${at} order must list two or more different parts of ${PART_NAMES.join(', ')}, front first`);
    }
    names.set(k.name, k);
    frames.add(k.frame);
  }
  for (const b of s.breakdowns ?? []) {
    const at = `poses: breakdown on frame ${b?.frame}`;
    const [from, to] = (b?.between ?? []).map((n) => names.get(n));
    if (!b.between || b.between.length !== 2 || !from || !to) throw new Error(`${at} names a key that is not in the sheet: ${JSON.stringify(b?.between)}`);
    if (!(from.frame < to.frame)) throw new Error(`${at} lists its keys "${from.name}" and "${to.name}" out of order`);
    if (!(b.frame > from.frame && b.frame < to.frame)) throw new Error(`${at} is not between "${from.name}" (${from.frame}) and "${to.name}" (${to.frame})`);
    if (!(isNum(b.favour) && b.favour > 0 && b.favour < 1) || b.favour === 0.5) throw new Error(`${at} favours ${b.favour}; it must be between 0 and 1 and never one half`);
    if (!BREAKDOWN_KINDS.includes(b.kind)) throw new Error(`${at} has an unknown kind ${JSON.stringify(b.kind)}`);
    if (typeof b.arc?.joint !== 'string' || !isNum(b.arc.offsetPx)) throw new Error(`${at} needs arc {joint, offsetPx}`);
    const [lo, hi] = TIMING_SHAPE.position[b.kind], pos = chordPosition(b);
    if (pos < lo - EPS || pos > hi + EPS) throw new Error(`${at} is ${b.kind} at ${pos.toFixed(3)} along the chord (favour ${b.favour}); ${b.kind} draws between ${lo} and ${hi}`);
    if (b.contact !== undefined && !(MATERIAL_IDS.includes(b.contact) && materialOf(b.contact).contact)) throw new Error(`${at} is a contact of "${b.contact}", which declares no contact frames in v3/materials.json`);
    if (b.joints !== undefined && (!isObj(b.joints) || Object.values(b.joints).some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(isNum)))) throw new Error(`${at} joints must map names to [x, y]`);
  }
  for (const c of s.secondaries ?? []) {
    if (typeof c?.name !== 'string' || !Array.isArray(c.joints) || !c.joints.length) throw new Error(`poses: a secondary needs a name and a list of joints (${JSON.stringify(c?.name)})`);
    if (c.material === undefined && (c.tip !== undefined || c.dropsAt !== undefined)) throw new Error(`poses: secondary "${c.name}" names a ${c.tip !== undefined ? 'tip' : 'dropsAt'} and no material: only a derived secondary can have one`);
    if (c.material !== undefined) {
      if (!MATERIAL_IDS.includes(c.material)) throw new Error(`poses: secondary "${c.name}" is made of "${c.material}", which v3/materials.json does not declare (${MATERIAL_IDS.join(', ')})`);
      const m = motionOf(materialOf(c.material));
      if (!m || m.lagFrames < 1) throw new Error(`poses: secondary "${c.name}" is made of "${c.material}", which declares no lag: a part that trails its primary needs a material that does`);
      if (c.lagDrawings !== undefined && 2 * c.lagDrawings > m.lagFrames) throw new Error(`poses: secondary "${c.name}" asks for ${c.lagDrawings} drawings (${2 * c.lagDrawings} frames) as its floor and its material "${c.material}" trails ${m.lagFrames}: the sheet's lag is a floor the material must clear`);
      if (c.tip !== undefined && (c.joints.length !== 1 || typeof c.tip.at !== 'string' || typeof c.tip.away !== 'string' || !Array.isArray(c.tip.offset) || c.tip.offset.length !== 2 || !c.tip.offset.every(isNum))) throw new Error(`poses: secondary "${c.name}" tip needs one joint name in joints and {at, away, offset: [x, y]}`);
      if (c.dropsAt !== undefined && !Number.isInteger(c.dropsAt)) throw new Error(`poses: secondary "${c.name}" dropsAt must be a whole frame`);
    } else if (!(Number.isInteger(c.lagDrawings) && c.lagDrawings! >= 1 && c.lagDrawings! <= 3)) throw new Error(`poses: secondary "${c.name}" lags ${c.lagDrawings} drawings; it must be 1-3 (or name a material)`);
    if (c.lagDrawings !== undefined && !(Number.isInteger(c.lagDrawings) && c.lagDrawings >= 1 && c.lagDrawings <= 3)) throw new Error(`poses: secondary "${c.name}" lags ${c.lagDrawings} drawings; it must be 1-3`);
    if (c.stretch !== undefined && !(isNum(c.stretch) && c.stretch >= 0 && c.stretch <= 1)) throw new Error(`poses: secondary "${c.name}" stretches ${c.stretch}; it must be 0-1`);
    if (c.side !== undefined && c.side !== 'L' && c.side !== 'R') throw new Error(`poses: secondary "${c.name}" side ${JSON.stringify(c.side)} must be L or R`);
  }
  for (const h of s.movingHolds ?? []) {
    if (!names.has(h?.key)) throw new Error(`poses: a moving hold names key "${h?.key}", which is not in the sheet`);
    if (!(isNum(h.driftPx) && h.driftPx >= 2 && h.driftPx <= 6)) throw new Error(`poses: moving hold on "${h.key}" drifts ${h.driftPx} px; it must be 2-6`);
    if (!(Number.isInteger(h.over) && h.over > 0)) throw new Error(`poses: moving hold on "${h.key}" needs a whole number of frames in over`);
  }
  s.breakdowns ??= [];
  s.secondaries ??= [];
  s.movingHolds ??= [];
  const faults = [...timingFaults(s), ...leadArmFaults(s), ...contactFaults(s)];
  if (faults.length) throw new Error(`poses: ${faults[0]}`);
  return s;
};

/** The drawings a move plays: [frame, kind] of every breakdown between `from` and `to` (the authored ones, else the two thirds `marksIn` adds from the end of the hold; kind 'automatic'). */
export const movesOf = (sheet: Pick<PoseSheet, 'keys' | 'breakdowns'>): {from: PoseKey; to: PoseKey; start: number; marks: {frame: number; kind: BreakdownKind | 'automatic'; favour: number; between: [string, string] | null}[]}[] => {
  const keys = [...sheet.keys].sort((p, q) => p.frame - q.frame);
  return keys.slice(0, -1).map((from, i) => {
    const to = keys[i + 1]!, start = from.frame + (from.hold ?? 0);
    const own = sheet.breakdowns.filter((b) => b.frame > from.frame && b.frame < to.frame).sort((p, q) => p.frame - q.frame);
    const marks = own.length
      ? own.map((b) => ({frame: b.frame, kind: b.kind as BreakdownKind | 'automatic', favour: b.favour, between: b.between}))
      : [1 / 3, 2 / 3].map((favour) => ({frame: Math.floor(Math.round(start + (to.frame - start) * favour) / 2) * 2, kind: 'automatic' as const, favour, between: null}));
    return {from, to, start, marks};
  });
};

/** What is wrong with the timing shape of every move of the sheet (see `TIMING_SHAPE`): one sentence each, empty when every move keeps it. */
export const timingFaults = (sheet: Pick<PoseSheet, 'keys' | 'breakdowns'>): string[] => {
  const out: string[] = [];
  for (const {from, to, start, marks} of movesOf(sheet)) {
    const at = `move "${from.name}" -> "${to.name}"`, [lo, hi] = TIMING_SHAPE.drawings;
    if (marks.length < lo || marks.length > hi) out.push(`${at} has ${marks.length} drawings; a move uses ${lo}-${hi} (C28)${marks.some((m) => m.kind === 'automatic') ? ' (none authored: the chart adds two thirds)' : ''}`);
    const kinds = marks.filter((m): m is typeof m & {kind: BreakdownKind} => m.kind !== 'automatic');
    for (const m of kinds) {
      if (m.between && (m.between[0] !== from.name || m.between[1] !== to.name)) out.push(`${at}: the breakdown on frame ${m.frame} names ${JSON.stringify(m.between)}, the keys its frame sits between`);
      if (from.hold !== undefined && m.frame < start) out.push(`${at}: the ${m.kind} on frame ${m.frame} sits inside the hold of "${from.name}" (it ends on frame ${start})`);
    }
    marks.slice(1).forEach((m, i) => marks[i]!.frame === m.frame && out.push(`${at}: two drawings on frame ${m.frame}`));
    for (const kind of ['anticipation', 'overshoot', 'settle'] as const) {
      const n = kinds.filter((m) => m.kind === kind).length;
      if (n > 1) out.push(`${at} has ${n} ${kind} drawings; at most one`);
    }
    kinds.slice(1).forEach((m, i) => KIND_RANK[kinds[i]!.kind] > KIND_RANK[m.kind] && out.push(`${at}: ${m.kind} on frame ${m.frame} comes after a ${kinds[i]!.kind}; the order is anticipation, passing, overshoot, settle`));
    marks.slice(1).forEach((m, i) => m.favour === marks[i]!.favour && out.push(`${at}: the drawing on frame ${m.frame} has the favour ${m.favour} of the one before it; the exposure sheet marks a breakdown only where the favour changes, so it would not show`));
    const passing = kinds.filter((m) => m.kind === 'passing');
    passing.slice(1).forEach((m, i) => m.favour <= passing[i]!.favour && out.push(`${at}: passing ${m.favour} on frame ${m.frame} does not rise past ${passing[i]!.favour}`));
  }
  return out;
};

/** Frames from a contact drawing to its settle drawing that a material allows: its declared `contact`, give or take one drawing on twos. */
export const CONTACT_SLACK = 2;

/**
 * The contact contract (material `contact`): a breakdown that is a `contact` of a material is followed, in the same move, by the move's `settle` drawing `contact` frames later (within `CONTACT_SLACK`), because the body
 * lands first and settles after. A contact with no settle in its move, or a settle too near or too far, is named.
 */
export const contactFaults = (sheet: Pick<PoseSheet, 'keys' | 'breakdowns'>): string[] => {
  const out: string[] = [];
  for (const {from, to, marks} of movesOf(sheet)) {
    const settle = marks.find((m) => m.kind === 'settle');
    for (const b of sheet.breakdowns.filter((x) => x.contact !== undefined && x.between[0] === from.name && x.between[1] === to.name)) {
      const want = materialOf(b.contact!).contact!.value, at = `move "${from.name}" -> "${to.name}": the contact of "${b.contact}" on frame ${b.frame}`;
      if (!settle) out.push(`${at} has no settle drawing after it; the body settles ${want} frames after a contact`);
      else if (settle.frame <= b.frame || Math.abs(settle.frame - b.frame - want) > CONTACT_SLACK) out.push(`${at} is followed by the settle on frame ${settle.frame}, ${settle.frame - b.frame} frames later; "${b.contact}" settles ${want} frames after a contact (within ${CONTACT_SLACK})`);
    }
  }
  return out;
};

/** The joints of a side's arm. */
export const armJoints = (side: Side): string[] => ['shoulder', 'elbow', 'wrist'].map((j) => j + side);

/** The secondaries that lag on the move into `to`: every one except those whose `side` is the side `to` leads with. */
export const activeSecondaries = (sheet: Pick<PoseSheet, 'secondaries'>, to: Pick<PoseKey, 'lead'>): Secondary[] => sheet.secondaries.filter((c) => !(c.side && c.side === to.lead.arm));

/**
 * The lead arm contract: on a move, the shoulder, elbow and wrist of the to-key's `lead.arm` belong to no secondary that lags on that move, because the arc probe judges the lead wrist
 * as authored motion and a lag would put its mechanics into the path. A secondary that holds those joints either names that `side` (it then moves with the body on the moves that side leads) or is refused.
 */
export const leadArmFaults = (sheet: Pick<PoseSheet, 'keys' | 'secondaries'>): string[] => {
  const out: string[] = [];
  for (const {from, to} of movesOf({keys: sheet.keys, breakdowns: []})) {
    if (to.lead.arm === 'none') continue;
    for (const c of activeSecondaries(sheet, to)) {
      const held = c.joints.filter((j) => armJoints(to.lead.arm as Side).includes(j));
      if (held.length) out.push(`move "${from.name}" -> "${to.name}": the lead arm (${to.lead.arm}) joint ${held.map((j) => `"${j}"`).join(', ')} belongs to secondary "${c.name}", which lags on that move; give it side "${to.lead.arm}" or leave the arm out`);
    }
  }
  return out;
};

// ---------- the spine ----------

type Vec = [number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1];
const len = (a: Vec): number => Math.hypot(a[0], a[1]);
const unit = (a: Vec, fallback: Vec = [0, -1]): Vec => (len(a) > 1e-9 ? mul(a, 1 / len(a)) : fallback);
/** The right of a direction: clockwise on screen (y down). For (0, -1), up, it is (1, 0). */
const rightOf = (a: Vec): Vec => [-a[1], a[0]];

const need = (j: Joints, name: string): Vec => {
  const p = j[name];
  if (!p) throw new Error(`pose: the joints have no "${name}"`);
  return p;
};

const cBasis = (t: number): number => 4 * t * (1 - t);
const sBasis = (t: number): number => (t * (1 - t) * (1 - 2 * t)) / SPINE_FIT.sPeak;

/**
 * The spine's interior samples: [chord fraction t, perpendicular offset in px] for the shoulder midpoint (when both shoulders exist), `torso`
 * and `neck`, against the chord from `root` to `head`. t is the projection onto the chord, so it does not depend on how the points are spaced along the spine.
 */
const spineSamples = (j: Joints): {chord: Vec; norm: number; samples: [number, number][]} => {
  const root = need(j, 'root'), head = need(j, 'head'), chord = sub(head, root), norm = len(chord);
  if (norm < 1e-6) throw new Error('pose: root and head coincide, so there is no spine');
  const n = rightOf(mul(chord, 1 / norm));
  const mid: Vec[] = j.shoulderL && j.shoulderR ? [mul(add(j.shoulderL, j.shoulderR), 0.5)] : [];
  const samples = [...mid, need(j, 'torso'), need(j, 'neck')].map((p): [number, number] => [dot(sub(p, root), chord) / (norm * norm), dot(sub(p, root), n)]);
  return {chord, norm, samples};
};

/**
 * The spine curve of a pose and the line of action it draws. The spine is the cubic Bezier from `root` to `head` whose control points sit a third of
 * the way along the chord, offset perpendicular to it by h1 and h2; its deviation from the chord at chord fraction t is 3t(1-t)[(1-t)h1 + t h2], written
 * here as alpha x 4t(1-t) (the C term) + beta x t(1-t)(1-2t)/0.0962 (the S term). alpha and beta are fitted by least squares, with a ridge on beta
 * (`SPINE_FIT.ridge`), to the perpendicular offsets of the shoulder midpoint, `torso` and `neck` from the chord, in fractions of `heightPx` (or of the
 * root-to-head distance when `heightPx` is absent). `bow` is the largest |deviation| along the curve. Class: I when bow < 0.04; S when the deviation changes
 * sign along the chord and both lobes reach 0.03; else C. `sign` is the side of the larger lobe (of the lobe nearer the root, for an S); `inflection` is the chord fraction where an S crosses.
 * (A four-point exact cubic through root, torso, neck and head was tried first: 2 px of jitter on one joint moved the bow by 0.10 of the figure, because
 * torso, neck and head bunch within 13 percent of the spine.)
 */
export const spineCurve = (joints: Joints, heightPx?: number): {class: LineClass; bow: number; sign: 1 | -1; inflection?: number} => {
  const [alpha, beta] = spineFit(joints, heightPx);
  return classifyProfile(alpha, beta);
};

/** The fitted (alpha, beta) of `spineCurve`: the C and S terms of the spine's deviation from the root-to-head chord, in fractions of `heightPx`. */
export const spineFit = (joints: Joints, heightPx?: number): [number, number] => {
  const {norm, samples} = spineSamples(joints);
  const scale = heightPx && heightPx > 0 ? heightPx : norm;
  let [cc, cs, ss, cd, sd] = [0, 0, 0, 0, 0];
  for (const [t, off] of samples) {
    const [c, s, d] = [cBasis(t), sBasis(t), off / scale];
    cc += c * c;
    cs += c * s;
    ss += s * s;
    cd += c * d;
    sd += s * d;
  }
  ss += SPINE_FIT.ridge;
  const det = cc * ss - cs * cs;
  return [(cd * ss - cs * sd) / det, (cc * sd - cs * cd) / det];
};

/** The class, bow, sign and inflection of the deviation profile alpha x C(t) + beta x S(t) (see `spineCurve`). */
export const classifyProfile = (alpha: number, beta: number): {class: LineClass; bow: number; sign: 1 | -1; inflection?: number} => {
  const n = SPINE_FIT.samples;
  const ts = Array.from({length: n}, (_, i) => i / (n - 1)), dev = ts.map((t) => alpha * cBasis(t) + beta * sBasis(t));
  const pos = Math.max(0, ...dev), neg = Math.max(0, ...dev.map((d) => -d)), bow = Math.max(pos, neg);
  if (bow < SPINE_FIT.straightBow) return {class: 'I', bow, sign: pos >= neg ? 1 : -1};
  if (pos >= SPINE_FIT.lobe && neg >= SPINE_FIT.lobe) {
    const first = dev.find((d) => Math.abs(d) > 1e-9)!;
    const cross = dev.findIndex((d, i) => i > 0 && Math.sign(d) === -Math.sign(first) && Math.abs(d) > 1e-12);
    return {class: 'S', bow, sign: first > 0 ? 1 : -1, inflection: ts[Math.max(0, cross - 1)]};
  }
  return {class: 'C', bow, sign: pos >= neg ? 1 : -1};
};

// ---------- twinning ----------

/** The bones that pair across the body, by name of the near joint and the far joint. */
const PAIRS: [string, string][] = [['shoulder', 'elbow'], ['elbow', 'wrist'], ['hip', 'knee'], ['knee', 'ankle']];
/** Mean mirror difference, in degrees, at which a pose is no longer a twin at all. */
export const TWIN_DEGREES = 40;

/**
 * How twinned the limbs are, 0 (nothing alike) to 1 (a perfect twin). Each of the four paired bones (upper arm, forearm, thigh, shin) is read as a
 * direction relative to the spine axis (root to head). For each pair the left and right directions are compared two ways: mirrored about the spine
 * (what a symmetric pose does) and parallel (both limbs doing the same thing); the pair's difference is the smaller of the two angles. The score is
 * 1 - (mean of the four differences) / 40 degrees, floored at 0. Both arms raised in a V over legs in an A scores near 1, as does both arms swinging
 * the same way over legs side by side; one arm up and one down, or legs apart unevenly, scores near 0.
 */
export const twinningScore = (joints: Joints): number => {
  const axis = unit(sub(need(joints, 'head'), need(joints, 'root')));
  const frame = (v: Vec): Vec => [dot(v, axis), axis[0] * v[1] - axis[1] * v[0]]; // along the spine, across it
  const angle = (a: Vec, b: Vec): number => Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], dot(a, b)));
  let total = 0;
  for (const [near, far] of PAIRS) {
    const [l, r] = (['L', 'R'] as const).map((s) => frame(sub(need(joints, far + s), need(joints, near + s)))) as [Vec, Vec];
    total += Math.min(angle([l[0], -l[1]], r), angle(l, r));
  }
  return Math.max(0, 1 - ((total / PAIRS.length) * 180) / Math.PI / TWIN_DEGREES);
};

// ---------- generating a pose from its spec ----------

export type RestSkeleton = {
  joints: Joints;
  /** Wrist or ankle reach as shoulder-to-wrist (hip-to-ankle) over the full limb length, by joint name (`wristL`, `ankleR`); overrides the lead/trail defaults when set. */
  reachRatios?: Record<string, number>;
  /** Bone length over the rest skeleton's, by distal joint name (`elbowL`); default 1. */
  limbRatios?: Record<string, number>;
  /** The figure height in the rest joints' own space; when given, bone lengths are scaled by heightPx over this. */
  restHeightPx?: number;
};

/** The defaults `solvePose` uses where the spec is silent. A starting drawing to correct by hand on the plate, not a rule. */
export const SOLVE_DEFAULTS = {
  /** The lead foot steps outward by this share of the stance width and rises by this share of the figure height (the rig has no depth axis: forward is drawn out and up). */
  leadLegStep: 0.2,
  leadLegLift: 0.03,
  /** Hip-to-ankle over leg length for the weight leg when no ankle reach is given. */
  weightLegReach: 0.97,
} as const;

/**
 * Where the silhouette kind puts the wrists (the pose sheet's `silhouette`; rubric C21 reads the filled silhouette, so the kind decides the arms, the lead only decides which arm goes further):
 *  - `star`: both arms up and out, past the horizontal: the wrists above the shoulders and well over 0.12 H from the spine (C21 asks 0.10 H of both for a star, so 0.12 H leaves margin);
 *  - `open`: both arms out and down off the torso, the wrists over 0.14 H from the spine (C21 asks 0.10 H of one);
 *  - `closed` and `fold`: the hands near the torso, on a point of the spine's chord (fraction `at` from the root, a fraction `off` of the height off to the arm's own side, or across to the other side for
 *    a fold: the arms cross);
 *  - `line`: along the spine's curve, the hands on its continuation past the head.
 * Angles are degrees from straight down, outward positive; reaches are shoulder-to-wrist over the arm's two bones (always at most 1: a bone is never stretched).
 */
export const SILHOUETTE_ARMS = {
  star: {target: 'angle', lead: 150, trail: 125, rest: 135, leadReach: 0.97, trailReach: 0.93},
  open: {target: 'angle', lead: 80, trail: 55, rest: 65, leadReach: 0.95, trailReach: 0.92},
  closed: {target: 'spine', at: 0.55, off: 0.04, cross: false},
  fold: {target: 'spine', at: 0.65, off: 0.03, cross: true},
  line: {target: 'extend', reach: 0.97, off: 0.03},
} as const;

const twoBone = (from: Vec, to: Vec, l1: number, l2: number, bend: 1 | -1): Vec => {
  const d = Math.min(Math.max(len(sub(to, from)), Math.abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6);
  const dir = unit(sub(to, from));
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  return add(add(from, mul(dir, a)), mul(rightOf(dir), h * bend));
};
const bendOf = (from: Vec, mid: Vec, to: Vec): 1 | -1 => (dot(sub(mid, from), rightOf(unit(sub(to, from)))) >= 0 ? 1 : -1);

/** The solved spine bows this much more than declared, so that rounding the joints to a hundredth of a pixel cannot read a declared bow of exactly the probe's floor (0.06) as 0.0599. */
const SOLVE_BOW_MARGIN = 0.002;

/** The most the shoulder line may be turned against the trunk to draw a declared S, degrees. */
export const SHOULDER_TILT_MAX = 35;

/** The profile (alpha, beta) whose fit `spineCurve` reads back as the declared line of action. Solves the linear map the ridge puts between the true and the fitted terms. */
const profileFor = (l: LineOfAction, ts: number[]): {target: [number, number]; command: [number, number]} => {
  const sign = l.sign, bow = l.bow + SOLVE_BOW_MARGIN;
  let [alpha, beta] = [sign * bow, 0];
  if (l.class === 'S') {
    const f = Math.min(0.75, Math.max(0.25, l.inflection ?? 0.5));
    const a = -sBasis(f) / cBasis(f), b = 1; // zero crossing at f
    const peak = Math.max(...Array.from({length: 201}, (_, i) => Math.abs(a * cBasis(i / 200) + b * sBasis(i / 200))));
    const first = a * cBasis(f / 2) + b * sBasis(f / 2);
    const k = (bow / peak) * (first >= 0 ? 1 : -1) * sign;
    [alpha, beta] = [a * k, b * k];
  }
  let [cc, cs, ss] = [0, 0, 0];
  for (const t of ts) {
    cc += cBasis(t) ** 2;
    cs += cBasis(t) * sBasis(t);
    ss += sBasis(t) ** 2;
  }
  // fitted = R x true with R = (AtA + ridge)^-1 AtA; invert it by fixed-point iteration (R is close to the identity on alpha)
  const det = cc * (ss + SPINE_FIT.ridge) - cs * cs;
  const fitOf = (a: number, b: number): [number, number] => {
    const cd = a * cc + b * cs, sd = a * cs + b * ss;
    return [(cd * (ss + SPINE_FIT.ridge) - cs * sd) / det, (cc * sd - cs * cd) / det];
  };
  let [a0, b0] = [alpha, beta];
  for (let i = 0; i < 40; i++) {
    const [fa, fb] = fitOf(a0, b0);
    a0 += alpha - fa;
    b0 += beta - fb;
  }
  return {target: [alpha, beta], command: [a0, b0]};
};

/**
 * A pose generated from a spec: the key's declared line of action, weight and lead, over the rest skeleton's bone lengths, in the rest skeleton's
 * space scaled to `heightPx`. The root, shoulder midpoint, torso, neck and head lie on the declared spine curve (class, bow, sign, inflection, with the
 * chord leaning `lineOfAction.lean` degrees); the root sits over the weight foot (`over` of the way from the other ankle to that one, between the ankles
 * for `both`); the weight leg stands at `reachRatios.ankleX` (default 0.97) of its length and the other ankle at the rest stance; the lead foot steps out and
 * up (`SOLVE_DEFAULTS`); the wrists go where the silhouette kind puts them (`SILHOUETTE_ARMS`); two-bone IK places knees and elbows on the rest skeleton's side. Every bone of the arms and legs keeps its
 * rest length: a target out of reach is drawn as far as the limb goes along the line to it. The trunk bones keep theirs too (the S a short neck and head cannot draw reads under its declared bow, down to
 * the probe's 0.06 floor).
 * Its `spineCurve` reads back the declared class and a bow within 0.02 of the declared one (scripts/animation/check-pose.mjs proves it on every key of the s01 sheet).
 */
export const solvePose = (spec: PoseKey, rest: RestSkeleton, heightPx: number): Joints => {
  const k = rest.restHeightPx ? heightPx / rest.restHeightPx : 1;
  const R = (n: string): Vec => mul(need(rest.joints, n), k);
  const boneLen = (a: string, b: string): number => len(sub(R(a), R(b))) * (rest.limbRatios?.[b] ?? 1);
  const loa = spec.lineOfAction;
  // spine
  const chordLen = len(sub(R('head'), R('root')));
  const lean = ((loa.lean ?? 0) * Math.PI) / 180, dirUp: Vec = [Math.sin(lean), -Math.cos(lean)];
  const restChord = sub(R('head'), R('root'));
  const restMid = mul(add(R('shoulderL'), R('shoulderR')), 0.5);
  const tOf = (p: Vec): number => dot(sub(p, R('root')), restChord) / dot(restChord, restChord);
  const spineNames: [string, number][] = [['shoulderMid', tOf(restMid)], ['torso', tOf(R('torso'))], ['neck', tOf(R('neck'))]];
  const {target, command} = profileFor(loa, spineNames.map(([, t]) => t));
  const nUp = rightOf(dirUp);
  // feet and root
  const ground = Math.max(R('ankleL')[1], R('ankleR')[1]);
  const ankle: Record<Side, Vec> = {L: [R('ankleL')[0], ground], R: [R('ankleR')[0], ground]};
  const stance = ankle.R[0] - ankle.L[0], centreX = (ankle.L[0] + ankle.R[0]) / 2;
  const lead = spec.lead.leg;
  if (lead !== 'none') {
    const out = lead === 'L' ? -1 : 1;
    ankle[lead] = [ankle[lead][0] + out * SOLVE_DEFAULTS.leadLegStep * Math.abs(stance), ground - SOLVE_DEFAULTS.leadLegLift * heightPx];
  }
  const foot = spec.weight.foot, other: Side = foot === 'L' ? 'R' : 'L';
  const rootX = foot === 'both' ? (ankle.L[0] + ankle.R[0]) / 2 : ankle[other][0] + spec.weight.over * (ankle[foot][0] - ankle[other][0]);
  const weightSide: Side = foot === 'both' ? (rootX < centreX ? 'L' : 'R') : foot;
  const legLen = boneLen('hipL', 'kneeL') + boneLen('kneeL', 'ankleL');
  const hipHalf = len(sub(R('hipR'), R('hipL'))) / 2;
  const reach = rest.reachRatios?.[`ankle${weightSide}`] ?? SOLVE_DEFAULTS.weightLegReach;
  const hx = rootX + (weightSide === 'L' ? -hipHalf : hipHalf) - ankle[weightSide][0];
  const rootY = ground - Math.sqrt(Math.max(0, (reach * legLen) ** 2 - hx * hx));
  const root: Vec = [rootX, rootY];
  // The trunk bones are walked along the curve at their rest lengths, so the joints no longer sit exactly on it and `spineCurve` reads back a little other than the profile
  // drawn. Close the loop: nudge the drawn profile by what the fit misses until the fit reads the declared one (a handful of passes; the fit is nearly linear in it).
  const build = (alpha: number, beta: number, spineStretch: number, neckStretch: number, tilt: number): Joints => {
    // the curve in place
    const devAt = (t: number): number => (alpha * cBasis(t) + beta * sBasis(t)) * heightPx;
    const at = (t: number): Vec => add(add(root, mul(mul(dirUp, chordLen), t)), mul(nUp, devAt(t)));
    const out: Joints = {root};
    const tangent = (t: number): Vec => unit(sub(at(Math.min(1, t + 0.01)), at(Math.max(0, t - 0.01))), dirUp);
    // trunk bones keep the rest skeleton's lengths: the joints stand on the curve at the chord fractions where the bones' Euclidean lengths are met, walking up from the root (a bone
    // of 19 px placed at a fixed chord fraction is stretched to 3x by a bow of 0.12, and the mesh the joints pin shears there); the shoulders and hips are carried rigidly by the
    // torso's and the root's own frame
    const walk = (fromT: number, dist: number): number => {
      const from = at(fromT);
      if (len(sub(at(1), from)) < dist) return 1;
      let [lo, hi] = [fromT, 1];
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (len(sub(at(mid), from)) < dist) lo = mid;
        else hi = mid;
      }
      return hi;
    };
    const tTorso = walk(0, boneLen('root', 'torso') * spineStretch), tNeck = walk(tTorso, boneLen('torso', 'neck') * neckStretch), tHead = walk(tNeck, boneLen('neck', 'head') * neckStretch);
    const torso = at(tTorso), neck = at(tNeck);
    out.head = at(tHead);
    out.torso = torso;
    out.neck = neck;
    // shoulders, hips, poncho
    const restUp = unit(restChord, [0, -1]);
    const turnBy = (v: Vec, a: number): Vec => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
    const angleTo = (u: Vec, v: Vec): number => Math.atan2(u[0] * v[1] - u[1] * v[0], dot(u, v));
    const trunkTurn = angleTo(restUp, tangent(tTorso)), rootTurn = angleTo(restUp, tangent(0));
    for (const s of ['L', 'R'] as const) {
      out[`shoulder${s}`] = add(torso, turnBy(sub(R(`shoulder${s}`), R('torso')), trunkTurn + tilt));
      out[`hip${s}`] = add(root, turnBy(sub(R(`hip${s}`), R('root')), rootTurn));
    }
    // the cloth's tip hangs where the root's frame carries it (over the hips), pulled or pushed along the line from the torso joint (its parent in the skeleton) to keep the bone's rest length
    const restPoncho = sub(R('ponchoPoint'), R('root')), rot = Math.atan2(dirUp[0], -dirUp[1]);
    const hung = add(root, [restPoncho[0] * Math.cos(rot) - restPoncho[1] * Math.sin(rot), restPoncho[0] * Math.sin(rot) + restPoncho[1] * Math.cos(rot)]);
    out.ponchoPoint = add(torso, mul(unit(sub(hung, torso)), boneLen('torso', 'ponchoPoint')));
    // legs: ankles fixed, knees by IK on the rest skeleton's side
    for (const s of ['L', 'R'] as const) {
      const hip = out[`hip${s}`]!;
      // a foot the leg cannot reach is drawn as far as the leg goes along the line to it (a lifted foot), not stretched
      const reachMax = 0.999 * (boneLen(`hip${s}`, `knee${s}`) + boneLen(`knee${s}`, `ankle${s}`)), want = sub(ankle[s], hip);
      const a = len(want) > reachMax ? add(hip, mul(unit(want), reachMax)) : ankle[s];
      const bend = bendOf(R(`hip${s}`), R(`knee${s}`), R(`ankle${s}`));
      out[`ankle${s}`] = a;
      out[`knee${s}`] = twoBone(hip, a, boneLen(`hip${s}`, `knee${s}`), boneLen(`knee${s}`, `ankle${s}`), bend);
    }
    // arms: two bones of fixed rest length from the shoulder to a wrist target the silhouette kind and the lead imply (`SILHOUETTE_ARMS`); a target the arm cannot reach is drawn as far
    // as the arm goes along the line to it (the elbow bends or the reach shortens), never by stretching a bone
    const down = mul(tangent(spineNames[0]![1]), -1);
    const spineAt = (t: number): Vec => at(t);
    for (const s of ['L', 'R'] as const) {
      const sh = out[`shoulder${s}`]!, side = s === 'L' ? -1 : 1, outward = mul(unit(sub(out.shoulderR!, out.shoulderL!)), side);
      const l1 = boneLen(`shoulder${s}`, `elbow${s}`), l2 = boneLen(`elbow${s}`, `wrist${s}`), full = l1 + l2;
      const isLead = spec.lead.arm === s, hasLead = spec.lead.arm !== 'none';
      const kind = SILHOUETTE_ARMS[spec.silhouette];
      let want: Vec;
      if (kind.target === 'spine') {
        // hands near the torso: a point on the spine, a little off to this side (closed) or over to the other side (fold, the arms cross)
        want = add(spineAt(kind.at), mul(outward, kind.off * heightPx * (kind.cross ? -1 : 1)));
      } else if (kind.target === 'extend') {
        // along the spine's curve, past the head: the point of the extended curve a full arm from the shoulder, a little off to this side
        let [lo, hi] = [0.2, 2.2];
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          if (len(sub(spineAt(mid), sh)) < kind.reach * full) lo = mid;
          else hi = mid;
        }
        want = add(spineAt(hi), mul(outward, kind.off * heightPx));
      } else {
        // `open` and `star`: the arm's angle from straight down, outward positive (past 90 degrees is above the shoulder), the lead arm further out than the trailing one
        const theta = ((isLead ? kind.lead : hasLead ? kind.trail : kind.rest) * Math.PI) / 180, reach = (isLead ? kind.leadReach : kind.trailReach) * full;
        want = add(sh, mul(add(mul(down, Math.cos(theta)), mul(outward, Math.sin(theta))), reach));
      }
      const target = rest.reachRatios?.[`wrist${s}`] !== undefined ? add(sh, mul(unit(sub(want, sh)), rest.reachRatios[`wrist${s}`]! * full)) : want;
      const reachMax = 0.999 * full, d = sub(target, sh);
      const wrist = len(d) > reachMax ? add(sh, mul(unit(d), reachMax)) : target;
      out[`wrist${s}`] = wrist;
      out[`elbow${s}`] = twoBone(sh, wrist, l1, l2, bendOf(R(`shoulder${s}`), R(`elbow${s}`), R(`wrist${s}`)));
    }
    return out;
  };
  /** The drawing whose fitted profile misses the declared one least, with the trunk bones held at `spineStretch` (root to torso) and `neckStretch` (torso to neck to head) times their rest length. */
  const draw = (spineStretch: number, neckStretch: number, tilt: number): {joints: Joints; miss: number} => {
    const fitOf = (c: [number, number]): [number, number] => spineFit(build(c[0], c[1], spineStretch, neckStretch, tilt), heightPx);
    const missOf = (f: [number, number]): [number, number] => [target[0] - f[0], target[1] - f[1]];
    const size = (m: [number, number]): number => Math.hypot(m[0], m[1]);
    let drawn: [number, number] = [command[0], command[1]], fit = fitOf(drawn), miss = missOf(fit);
    for (let pass = 0; pass < 40 && size(miss) > 5e-4; pass++) {
      // Gauss-Newton on the 2 x 2 map (drawn profile -> fitted profile), Jacobian by finite differences, the step halved until the miss shrinks
      const eps = 1e-3, fa = fitOf([drawn[0] + eps, drawn[1]]), fb = fitOf([drawn[0], drawn[1] + eps]);
      const j00 = (fa[0] - fit[0]) / eps, j10 = (fa[1] - fit[1]) / eps, j01 = (fb[0] - fit[0]) / eps, j11 = (fb[1] - fit[1]) / eps;
      const det = j00 * j11 - j01 * j10;
      if (Math.abs(det) < 1e-12) break;
      const step: [number, number] = [(miss[0] * j11 - miss[1] * j01) / det, (miss[1] * j00 - miss[0] * j10) / det];
      let moved = false;
      for (let half = 1; half > 1 / 64; half /= 2) {
        const next: [number, number] = [drawn[0] + step[0] * half, drawn[1] + step[1] * half], f = fitOf(next), m = missOf(f);
        if (size(m) < size(miss)) {
          [drawn, fit, miss, moved] = [next, f, m, true];
          break;
        }
      }
      if (!moved) break;
    }
    return {joints: build(drawn[0], drawn[1], spineStretch, neckStretch, tilt), miss: size(miss)};
  };
  const shortfall = (j: Joints): number => {
    const read = spineCurve(j, heightPx);
    return (read.class === loa.class ? 0 : 1) + Math.abs(read.bow - (loa.bow + SOLVE_BOW_MARGIN));
  };
  // Every bone keeps its rest length. A curve the short bones cannot draw (an S bows the trunk further than the neck and head allow) is helped by tilting the shoulder line against the trunk's
  // turn (a contrapposto: the shoulders carried by the torso joint at their rest distance, turned up to SHOULDER_TILT_MAX degrees), smallest tilt first; the drawing that reads closest to the declared
  // class and bow wins (the untilted one on a tie). What still reads under the probe's bow floor is the declaration's, not the solver's.
  let best = draw(1, 1, 0), bestShort = shortfall(best.joints);
  for (let deg = 5; bestShort > 3e-3 && deg <= SHOULDER_TILT_MAX; deg += 5) {
    for (const sign of [1, -1]) {
      const next = draw(1, 1, (sign * deg * Math.PI) / 180), short = shortfall(next.joints);
      if (short < bestShort - 1e-4) [best, bestShort] = [next, short];
    }
  }
  const joints = best.joints;
  return joints;
};

// ---------- breakdowns ----------

/** The descendants of `joint` (children, grandchildren ...) by the child-to-parent map; empty when `parents` is absent. */
const descendantsOf = (joint: string, parents?: Record<string, string>): string[] => {
  if (!parents) return [];
  const below = (n: string): boolean => parents[n] === joint || (parents[n] !== undefined && below(parents[n]!));
  return Object.keys(parents).filter(below);
};

/**
 * The drawing a breakdown shows. With `b.joints` it is that drawing. Without, it is built from the keys: blend `from` toward `to` as `blendPose`
 * does at t = favour (passing, settle); an anticipation goes the other way, to t = -0.25 x favour, and an overshoot goes past the key, to t = 1 + 0.25 x favour
 * (`REACH_PAST`: the reach is a quarter of the move at favour 1, so favour 0.4 is a tenth of the move). Then `b.arc.joint` and everything below it
 * moves `offsetPx` perpendicular to that joint's chord between the keys (positive: the right of the direction first key to second key; a joint that does
 * not move between the keys is pushed along the x axis), so the path of that joint bows out of the straight line the blend alone would draw.
 */
export const breakdownPose = (from: Joints, to: Joints, b: PoseBreakdown, parents?: Record<string, string>): Joints => {
  if (b.joints) return b.joints;
  const t = b.kind === 'anticipation' ? -REACH_PAST * b.favour : b.kind === 'overshoot' ? 1 + REACH_PAST * b.favour : b.favour;
  const out = blendPose(from, to, t, parents);
  const j = b.arc.joint;
  if (!from[j] || !to[j]) throw new Error(`breakdown on frame ${b.frame}: arc names joint "${j}", which the keys do not have`);
  const chord = sub(to[j]!, from[j]!), n = len(chord) > 1e-9 ? rightOf(unit(chord)) : ([1, 0] as Vec), delta = mul(n, b.arc.offsetPx);
  for (const name of [j, ...descendantsOf(j, parents)]) if (out[name]) out[name] = add(out[name]!, delta);
  return out;
};

// ---------- moving holds ----------

/**
 * How far a moving hold has drifted `frame` frames after its key landed: [dx, dy] in key-sheet pixels. A smoothstep from 0 to `driftPx` over `over`
 * frames, then still at `driftPx`; the direction is mostly down (weight settling) tilted up to 0.32 rad to either side by a hash of the key's name, so it is
 * slow, one-way and the same on every run. Read on twos (the frame is floored to an even number), as the drawn layer is.
 */
export const movingHoldOffset = (hold: MovingHold, frame: number): [number, number] => {
  let h = 2166136261;
  for (const ch of hold.key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const phi = ((h % 9) - 4) * 0.08;
  const t = Math.min(1, Math.max(0, Math.floor(frame / 2) * 2) / hold.over), e = t * t * (3 - 2 * t);
  return [Math.sin(phi) * hold.driftPx * e, Math.cos(phi) * hold.driftPx * e];
};

// ---------- the chart ----------

/**
 * The frame of the first drawing of the move that leaves `keyName`: its first breakdown, else the next key's frame; the key's own frame when no move leaves it
 * (the last key). A moving hold drifts until then, so the drift hands over to the move inside its first drawing instead of snapping back on the frame the hold ends.
 */
export const firstDrawingAfter = (sheet: PoseSheet, keys: KeySheet, keyName: string): number => {
  const own = sheet.keys.find((k) => k.name === keyName)!;
  const frames = sheet.breakdowns.filter((b) => b.between[0] === keyName).map((b) => b.frame);
  const next = keys.keys.map((k) => k.frame).filter((f) => f > own.frame).sort((a, b) => a - b)[0];
  return Math.min(...frames, next ?? own.frame);
};

/** Frames a secondary trails: its material's declared lag, else the sheet's hand-written drawings x 2. With both, the material is the lag and the sheet's number the floor it must clear (`parsePoseSheet`). */
export const lagFramesOf = (c: Pick<Secondary, 'material' | 'lagDrawings'>): number => (c.material ? motionOf(materialOf(c.material))!.lagFrames : c.lagDrawings! * 2);

/** The frame windows in which a side's secondary does not lag: each move that side leads, from the end of the from-key's hold to the to-key's frame plus the lag, so the part lands with the body. */
const leadWindows = (sheet: PoseSheet, keys: KeySheet, c: Secondary): [number, number][] =>
  c.side ? movesOf({keys: sheet.keys.map((k) => ({...k, hold: keys.keys.find((n) => n.name === k.name)?.hold ?? k.hold}) as PoseKey), breakdowns: []}).filter(({to}) => to.lead.arm === c.side).map(({to, start}) => [start, to.frame + lagFramesOf(c)] as [number, number]) : [];

/** Frames past the last key's hold over which a derived secondary is still run: the longest settle a material declares is 30, so a part is at rest long before this. */
export const FOLLOW_TAIL = 60;

/**
 * The derived secondaries of a sheet (`material`): the primary pose on every frame from the first key to the last key's hold plus `FOLLOW_TAIL` (the pose `poseAt` plays with no lag and no drift), each secondary
 * joint's path and its bone vector from its parent run through the material's chain (`followOf`: stepped on ones, drawn on twos). One chain per joint and per space, built once per chart.
 */
const followsOf = (sheet: PoseSheet, keys: KeySheet, bare: PoseChart, parents?: Record<string, string>): PoseFollow[] => {
  const derived = sheet.secondaries.filter((c) => c.material);
  if (!derived.length) return [];
  const frames = keys.keys.map((k) => k.frame), last = keys.keys.reduce((m, k) => Math.max(m, k.frame + (k.hold ?? 0)), 0);
  const from = quantise(Math.min(...frames), 2), to = last + FOLLOW_TAIL;
  const poses: Joints[] = Array.from({length: to - from + 1}, (_, i) => poseAt(bare, from + i, parents));
  return derived.map((c): PoseFollow => {
    const motion = motionOf(materialOf(c.material!))!, stretch = c.stretch ?? 0;
    const world: PoseFollow['world'] = {}, rel: PoseFollow['rel'] = {};
    const virtual = c.tip ? {name: c.joints[0]!, ...c.tip} : undefined;
    const off: [number, number][] = [...leadWindows(sheet, keys, c), ...(c.dropsAt !== undefined ? [[c.dropsAt, Infinity] as [number, number]] : [])];
    // a part does not follow inside an `off` window (it is the body's there), so its chain runs on each stretch between the windows, from rest where the stretch begins: a chain that ran on through the window would
    // carry the whole of the body's move into the stretch after it and pop the part onto it
    const free = (f: number): boolean => !off.some(([a, b]) => f >= a && f < b);
    const segments: [number, number][] = [];
    let begin = -1;
    for (let i = 0; i <= poses.length; i++) {
      const on = i < poses.length && free(from + i);
      if (on && begin < 0) begin = i + ((from + i) % 2);
      if (!on && begin >= 0) {
        if (i - begin >= 2) segments.push([begin, i]);
        begin = -1;
      }
    }
    const along = (path: [number, number][]): [number, number][] => {
      const out: [number, number][] = path.map(() => [0, 0]);
      for (const [a, b] of segments) followOf(motion, path.slice(a, b), sheet.heightPx).forEach((d, i) => (out[a + i] = d));
      return out;
    };
    for (const name of c.joints) {
      const path = poses.map((p) => (virtual ? virtualJoint(virtual, p) : p[name]!));
      if (path.some((p) => !p)) throw new Error(`poseChartFrom: secondary "${c.name}" names joint "${name}", which the key sheet does not have`);
      const parent = virtual ? virtual.at : parents?.[name];
      world[name] = stretch > 0 ? along(path) : path.map(() => [0, 0]);
      rel[name] = stretch < 1 && parent ? along(path.map((p, i) => [p[0] - poses[i]![parent]![0], p[1] - poses[i]![parent]![1]])) : path.map(() => [0, 0]);
    }
    return {joints: c.joints, from, stretch, world, rel, virtual, off};
  });
};

/**
 * The chart `poseAt` plays for a pose sheet over its key sheet. Keys and holds are the key sheet's; every pose-sheet breakdown carries a real drawing
 * (`joints` if authored, else `breakdownPose`), and replaces the key sheet's own breakdown list (a segment with none still gets thirds); a secondary with no `material` is
 * delayed `lagDrawings` x 2 frames behind the body (`PoseChart.lags`), one with a `material` is drawn where that material's chain puts it (`PoseChart.follows`, `followsOf`: the lag, settle and
 * overshoot are the material's and the sheet's `lagDrawings`, when it has one, is only the floor `parsePoseSheet` holds the material to); each moving hold drifts the whole figure by `movingHoldOffset` from its key's
 * landing, reaching its full drift after `over` frames and staying there until the first drawing of the move that leaves the key (`firstDrawingAfter`; a drift that stopped at `over`, or at the hold's end, snapped the figure back on a drawing of its own). Throws when a pose key is not on the key sheet at the same frame. `parents` (child to parent) makes
 * blends swing bones and lets an arc carry its limb with it.
 */
export const poseChartFrom = (sheet: PoseSheet, keys: KeySheet, parents?: Record<string, string>): PoseChart => {
  const named = new Map(keys.keys.map((k) => [k.name, k]));
  for (const k of sheet.keys) {
    const kk = named.get(k.name);
    if (!kk) throw new Error(`poseChartFrom: pose key "${k.name}" is not on the key sheet`);
    if (kk.frame !== k.frame) throw new Error(`poseChartFrom: pose key "${k.name}" is on frame ${k.frame}, the key sheet has it on ${kk.frame}`);
  }
  const breakdowns = sheet.breakdowns.map((b) => ({frame: b.frame, favour: b.favour, value: breakdownPose(named.get(b.between[0])!.joints, named.get(b.between[1])!.joints, b, parents)}));
  const drifts = sheet.movingHolds.map((h) => {
    const key = named.get(h.key)!, holdEnd = key.frame + (key.hold ?? h.over);
    return {from: key.frame, to: Math.max(holdEnd, firstDrawingAfter(sheet, keys, key.name)), offset: (since: number) => movingHoldOffset(h, since)};
  });
  const bare: PoseChart = {keys: keys.keys.map((k) => ({frame: k.frame, joints: k.joints, hold: k.hold})), breakdowns};
  const follows = followsOf(sheet, keys, bare, parents);
  return {
    ...bare,
    lags: sheet.secondaries.filter((c) => !c.material).map((c) => ({joints: c.joints, frames: c.lagDrawings! * 2, stretch: c.stretch, off: leadWindows(sheet, keys, c)})),
    ...(follows.length ? {follows} : {}),
    drifts,
  };
};

/** The key sheet with its breakdown list replaced by the pose sheet's (frame and favour), so `describeFrame` and the exposure sheet describe the frames `poseChartFrom` plays. */
export const poseKeySheet = (sheet: PoseSheet, keys: KeySheet): KeySheet => ({...keys, breakdowns: sheet.breakdowns.map((b) => ({frame: b.frame, favour: b.favour}))});

// ---------- paths ----------

/**
 * Largest perpendicular distance of any point of a path (one joint, one position per drawing) from the chord between its first and last point; 0 for fewer than 3 points.
 * This is the reach of an arc only (probe check d). Whether the path IS an arc is `arc_faults` in `scripts/animation/probe_common.py`: the deviation has one sign on every
 * interior drawing (a bow, not a zigzag), progress along the chord never goes back by more than 1 px, and no turn between consecutive segments exceeds 90 degrees.
 */
export const arcDeviation = (path: [number, number][]): number => {
  if (path.length < 3) return 0;
  const a = path[0]!, c = sub(path[path.length - 1]!, a), n = len(c);
  return Math.max(...path.map((p) => (n < 1e-9 ? len(sub(p, a)) : Math.abs(c[0] * (p[1] - a[1]) - c[1] * (p[0] - a[0])) / n)));
};

/** The distance between each pair of consecutive drawings of a path: how far the joint travels per drawing. An ease reads small, large, small. */
export const spacingProfile = (path: [number, number][]): number[] => path.slice(1).map((p, i) => len(sub(p, path[i]!)));
