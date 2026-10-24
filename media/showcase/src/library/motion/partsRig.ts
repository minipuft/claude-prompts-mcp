import {Arap} from './arap';
import type {Joints} from '../motion';

/**
 * The parts rig (row 6.9, D85): a plate family cut by its skeleton into parts (assets/<actor>/families/<family>/parts/, scripts/animation/cut-parts.mjs), each part its own ARAP mesh
 * pinned at its bone's joints, drawn in a per-key order. One crossed, folded or overhead limb is held by the order the parts are drawn in instead of by tearing one sheet.
 *
 * Pure: no DOM, no Node API, so the renderer that composes the plate (scripts/animation/plates-from-poses.mjs, through load-ts.mjs) and the film's MeshFigure run this same code for
 * the pins a part gets and the order it is drawn in. Joints are in the family's mask space (the key sheet's space at heightPx 922).
 */

/** The parts of the human, back to front in their default order's first approximation; `cut_parts.py` writes exactly these names, `parseParts` refuses a file that differs. */
export const PART_NAMES = ['hair', 'head', 'torso', 'poncho', 'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR', 'upperLegL', 'lowerLegL', 'footL', 'upperLegR', 'lowerLegR', 'footR'] as const;
export type PartName = (typeof PART_NAMES)[number];

export type PartMesh = {vertices: number[]; triangles: number[]; uvs: number[]};
export type PartPin = {joint: string; rest: [number, number]};
export type PartSpec = {
  name: PartName;
  id: number;
  png: string;
  ramp: string;
  offset: [number, number];
  size: [number, number];
  /** The bone whose rotation a rigid part follows: `bone[1] - bone[0]`, rest to pose. */
  bone: [string, string];
  /** `limb`: pinned at its own joints (the bone may stretch). `rigid`: moves by its bone's rotation about `pivot`, pins are the pivot joint and `anchors`. */
  mode: 'limb' | 'rigid';
  pivot: string;
  pins: PartPin[];
  anchors: [number, number][];
  /** The default draw order, larger in front. */
  z: number;
  reaches: Record<string, {joint: string | null; capPx?: number}>;
  mesh: PartMesh;
};
export type PartsFile = {family: string; actor: string; overlapPx: number; capMaxPx: number; owners: string; parts: PartSpec[]};

/** A parts file read from JSON, or an error naming what is wrong: the parts are exactly PART_NAMES, every pin names a joint of `restJoints`, every part has a mesh. */
export const parseParts = (json: unknown, restJoints: Joints): PartsFile => {
  const f = json as PartsFile;
  if (!f || !Array.isArray(f.parts)) throw new Error('parts: the file has no parts');
  const names = f.parts.map((p) => p.name).join(',');
  if (names !== PART_NAMES.join(',')) throw new Error(`parts: the file's parts (${names}) are not ${PART_NAMES.join(', ')}`);
  for (const p of f.parts) {
    for (const j of [...p.bone, p.pivot, ...p.pins.map((q) => q.joint)]) if (!restJoints[j]) throw new Error(`parts: ${p.name} names joint "${j}", which the skeleton does not have`);
    if (!p.mesh?.vertices?.length || !p.mesh.triangles?.length) throw new Error(`parts: ${p.name} has no mesh`);
    if (p.mode === 'rigid' && p.anchors.length < 2) throw new Error(`parts: rigid part ${p.name} needs at least two anchors`);
  }
  return f;
};

const angle = (a: [number, number], b: [number, number]): number => Math.atan2(b[1] - a[1], b[0] - a[0]);

/** How far the bone of `spec` turned from `rest` to `now`, radians. */
export const boneTurn = (spec: Pick<PartSpec, 'bone'>, rest: Joints, now: Joints): number => {
  const [a, b] = spec.bone;
  return angle(now[a]!, now[b]!) - angle(rest[a]!, rest[b]!);
};

const turned = (v: [number, number], t: number): [number, number] => [v[0] * Math.cos(t) - v[1] * Math.sin(t), v[0] * Math.sin(t) + v[1] * Math.cos(t)];

/** The pin positions of a part at rest: its joint pins, then (rigid parts) its anchors. */
export const restPins = (spec: PartSpec): Float32Array => Float32Array.from([...spec.pins.flatMap((p) => p.rest), ...(spec.mode === 'rigid' ? spec.anchors.flat() : [])]);

/**
 * The pin positions of a part in the pose `now`, in the order of `restPins`. A joint pin sits where its joint is, plus the offset it had from the joint at rest turned by the part's
 * bone (a pin on a point the joint is not on, the cape's tip drawn short of the poncho-point joint). A rigid part's anchors are its pivot joint's position plus their rest offset from the pivot
 * turned by the bone: the part moves, never scales.
 */
export const livePins = (spec: PartSpec, rest: Joints, now: Joints): Float32Array => {
  const t = boneTurn(spec, rest, now), out: number[] = [];
  for (const p of spec.pins) {
    const off = turned([p.rest[0] - rest[p.joint]![0], p.rest[1] - rest[p.joint]![1]], t);
    out.push(now[p.joint]![0] + off[0], now[p.joint]![1] + off[1]);
  }
  if (spec.mode === 'rigid') {
    const pr = rest[spec.pivot]!, pn = now[spec.pivot]!;
    for (const a of spec.anchors) {
      const off = turned([a[0] - pr[0], a[1] - pr[1]], t);
      out.push(pn[0] + off[0], pn[1] + off[1]);
    }
  }
  return Float32Array.from(out);
};

/** One ARAP solver per part, built once at the rest pose. `pose(now)` is every part's vertices in the pose, mask space. */
export class PartsRig {
  readonly file: PartsFile;
  private readonly rest: Joints;
  private readonly solvers: Map<PartName, Arap>;
  constructor(file: PartsFile, rest: Joints) {
    this.file = file;
    this.rest = rest;
    this.solvers = new Map(
      file.parts.map((p) => {
        const arap = new Arap({vertices: Float32Array.from(p.mesh.vertices), triangles: Uint32Array.from(p.mesh.triangles)}, restPins(p));
        if (arap.droppedPins.length) throw new Error(`parts: ${p.name} has pins outside its mesh (${arap.droppedPins.join(', ')}); run \`npm run parts\``);
        return [p.name, arap];
      }),
    );
  }
  pose(now: Joints): Record<PartName, Float32Array> {
    return Object.fromEntries(this.file.parts.map((p) => [p.name, this.solvers.get(p.name)!.solve(livePins(p, this.rest, now))])) as Record<PartName, Float32Array>;
  }
}

/** The side of the line through `a` and `b` that `p` lies on: 1, -1, or 0 on it. */
const sideOf = (a: [number, number], b: [number, number], p: [number, number]): number => Math.sign((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));

const segmentsCross = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean => sideOf(a, b, c) * sideOf(a, b, d) < 0 && sideOf(c, d, a) * sideOf(c, d, b) < 0;

/** What a limb does to the order: `lead` is the key's declared lead, `crossing` the limb's far joint is over the spine from its own side. */
export type LimbDepth = {front: boolean; reason: 'lead' | 'crossing' | null};

/** The default draw order's inputs for each limb, read off the pose: the declared lead arm and leg, and an arm or leg whose far joint is on the other side of the spine from its root joint. */
export const limbDepths = (now: Joints, lead: {arm: 'L' | 'R' | 'none'; leg: 'L' | 'R' | 'none'}, weightFoot: 'L' | 'R' | 'both' = 'both'): Record<'armL' | 'armR' | 'legL' | 'legR', LimbDepth> => {
  const root = now.root!, neck = now.neck!;
  const across = (rootJoint: string, farJoint: string): boolean => {
    const a = sideOf(root, neck, now[rootJoint]!), b = sideOf(root, neck, now[farJoint]!);
    return a !== 0 && b !== 0 && a !== b;
  };
  const one = (isLead: boolean, crosses: boolean): LimbDepth => ({front: isLead || crosses, reason: isLead ? 'lead' : crosses ? 'crossing' : null});
  // a declared lead leg is the one leg in front; the crossing test only speaks for legs when none leads
  const out = {
    armL: one(lead.arm === 'L', across('shoulderL', 'wristL')), armR: one(lead.arm === 'R', across('shoulderR', 'wristR')),
    legL: one(lead.leg === 'L', lead.leg === 'none' && across('hipL', 'ankleL')), legR: one(lead.leg === 'R', lead.leg === 'none' && across('hipR', 'ankleR')),
  };
  // two legs that cross each other with no lead leg between them: the leg that is not carrying the weight swings across in front
  const chain = (s: 'L' | 'R') => [now[`hip${s}`]!, now[`knee${s}`]!, now[`ankle${s}`]!] as [number, number][];
  const [l, r] = [chain('L'), chain('R')];
  const legsCross = [0, 1].some((i) => [0, 1].some((j) => segmentsCross(l[i]!, l[i + 1]!, r[j]!, r[j + 1]!)));
  if (!out.legL.front && !out.legR.front && legsCross && weightFoot !== 'both') out[weightFoot === 'L' ? 'legR' : 'legL'] = {front: true, reason: 'crossing'};
  return out;
};

/**
 * The default draw order, front to back, derived from the solved joints. The part files carry a `z` for every part at rest; the rule moves a limb:
 *  - the lead arm, and an arm whose wrist crosses the spine, is drawn in front of the torso and the head (its hand covers the body it crosses; the sleeve stays over its forearm), the lead arm over the one that only crosses;
 *    the other arm tucks its forearm and hand behind the poncho;
 *  - the lead leg, and a leg whose ankle crosses the spine, is drawn in front of the other leg (both stay behind the poncho); with no lead leg, two legs that cross each other put the leg
 *    that does not carry the weight in front;
 *  - the poncho is behind the torso, the hair behind the head and everything else.
 */
export const defaultOrder = (file: PartsFile, now: Joints, lead: {arm: 'L' | 'R' | 'none'; leg: 'L' | 'R' | 'none'}, weightFoot: 'L' | 'R' | 'both' = 'both'): PartName[] => {
  const d = limbDepths(now, lead, weightFoot);
  const z = new Map<PartName, number>(file.parts.map((p) => [p.name, p.z]));
  for (const s of ['L', 'R'] as const) {
    // the lead arm over everything, an arm that only crosses the spine over the torso and the head but under the lead arm
    if (d[`arm${s}`].front) { const k = d[`arm${s}`].reason === 'lead' ? 15 : 14.2; z.set(`foreArm${s}`, k); z.set(`upperArm${s}`, k + 0.1); z.set(`hand${s}`, k + 0.2); }
    if (d[`leg${s}`].front) { z.set(`upperLeg${s}`, 4.2); z.set(`lowerLeg${s}`, 4.1); z.set(`foot${s}`, 4); }
  }
  return [...file.parts].sort((a, b) => z.get(b.name)! - z.get(a.name)! || a.id - b.id).map((p) => p.name);
};

/**
 * A key's own `order` over the rule's: the parts it lists exchange the places the rule gave them, in the order the key lists them (front first), and every part it does not list keeps its place.
 */
export const applyOrder = (base: readonly PartName[], override?: readonly PartName[]): PartName[] => {
  if (!override?.length) return [...base];
  const slots = base.map((n, i) => [n, i] as const).filter(([n]) => override.includes(n)).map(([, i]) => i).sort((a, b) => a - b);
  const out = [...base];
  override.forEach((n, k) => { out[slots[k]!] = n; });
  return out;
};

/** For a draw order (front first): the part ids each part is drawn in front of, as the flag table the compositor reads (`front[id]` is 1 when `name` is in front of the part with that id; id 0, the background, is always behind). */
export const frontOf = (file: PartsFile, order: readonly PartName[], name: PartName): Uint8Array => {
  const rank = new Map(order.map((n, i) => [n, i] as const));
  const flags = new Uint8Array(file.parts.length + 1);
  flags[0] = 1;
  for (const p of file.parts) flags[p.id] = rank.get(name)! < rank.get(p.name)! ? 1 : 0;
  return flags;
};
